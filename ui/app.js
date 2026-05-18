const PLAYER_PINNED_KEY = "cet6-player-pinned";
const PLAYER_POSITION_KEY = "cet6-player-position";
const TRACK_SORT_KEY = "cet6-track-sort-direction";
const TRANSLATION_VISIBLE_KEY = "cet6-translation-visible";
const VIEW_STATE_KEY = "cet6-browser-state";
const DEFAULT_EXAM = "cet6";
const EXAM_LABELS = {
  cet6: "CET-6",
  cet4: "CET-4",
};

let lineLoopFrameId = null;

const state = {
  catalog: [],
  currentExam: DEFAULT_EXAM,
  currentTrack: null,
  sections: [],
  lines: [],
  activeIndex: -1,
  loopLineId: null,
  timingsReady: false,
  userSeeking: false,
  playerPinned: false,
  trackSortDirection:
    localStorage.getItem(TRACK_SORT_KEY) === "desc" ? "desc" : "asc",
  translationVisible: localStorage.getItem(TRANSLATION_VISIBLE_KEY) === "true",
  browserState: loadBrowserState(),
  browserStateSaveTimer: 0,
  pendingTrackListScrollTop: null,
  pendingTrackRestore: null,
  lastPlaybackStateSaveAt: 0,
};

const els = {
  shell: document.querySelector("#shell"),
  audio: document.querySelector("#audio"),
  nowPlaying: document.querySelector(".now-playing"),
  pinPlayer: document.querySelector("#pinPlayer"),
  playBtn: document.querySelector("#playBtn"),
  backBtn: document.querySelector("#backBtn"),
  forwardBtn: document.querySelector("#forwardBtn"),
  progress: document.querySelector("#progress"),
  currentTime: document.querySelector("#currentTime"),
  duration: document.querySelector("#duration"),
  trackList: document.querySelector("#trackList"),
  sortTrackList: document.querySelector("#sortTrackList"),
  examTabs: document.querySelector("#examTabs"),
  sectionNav: document.querySelector("#sectionNav"),
  transcript: document.querySelector("#transcript"),
  trackName: document.querySelector("#trackName"),
  trackMeta: document.querySelector("#trackMeta"),
  autoScroll: document.querySelector("#autoScroll"),
  workspace: document.querySelector(".workspace"),
  transcriptVisible: document.querySelector("#transcriptVisible"),
  translationVisible: document.querySelector("#translationVisible"),
  hideLeftSidebar: document.querySelector("#hideLeftSidebar"),
  hideRightSidebar: document.querySelector("#hideRightSidebar"),
  showLeftSidebar: document.querySelector("#showLeftSidebar"),
  showRightSidebar: document.querySelector("#showRightSidebar"),
  leftResizer: document.querySelector("#leftResizer"),
  rightResizer: document.querySelector("#rightResizer"),
};

init();

async function init() {
  restoreLayoutState();
  restorePlayerPinned();
  restorePlayerPosition();
  bindEvents();

  try {
    const response = await fetch("tracks.json", { cache: "no-store" });
    state.catalog = normalizeCatalog(await response.json());

    const params = new URLSearchParams(window.location.search);
    state.currentExam = resolveInitialExam(params);
    state.pendingTrackListScrollTop = getSavedTrackListScrollTop(
      state.currentExam,
    );
    renderExamTabs();
    renderTrackList();

    const trackId = params.get("track") || getSavedTrackId(state.currentExam);
    const orderedCatalog = getOrderedCatalog(state.currentExam);
    const track =
      findTrack(trackId, state.currentExam) ||
      orderedCatalog.find((t) => t.available) ||
      orderedCatalog[0];

    if (track) {
      await switchTrack(track.id, false, track.exam);
    } else {
      renderEmptyExamState(state.currentExam);
    }
  } catch (error) {
    console.error("Failed to load catalog:", error);
    els.transcript.innerHTML = `<div class="empty-state">加载听力列表失败，请确认 tracks.json 存在。</div>`;
  }
}

async function switchTrack(trackId, pushState = true, exam = state.currentExam) {
  const track = findTrack(trackId, exam);
  if (!track) return;

  persistCurrentViewState(true);
  state.currentExam = track.exam;
  state.browserState.currentExam = track.exam;
  state.pendingTrackListScrollTop = getSavedTrackListScrollTop(track.exam);
  state.currentTrack = track;
  state.browserState.currentTrackIds[track.exam] = track.id;
  state.pendingTrackRestore = createPendingTrackRestore(track.id, track.exam);
  resetPlaybackState();
  els.trackName.textContent = track.title;
  els.audio.src = encodeURI(track.audio);
  els.audio.load();

  if (pushState) {
    const url = new URL(window.location);
    url.pathname = getExamPath(track.exam);
    url.searchParams.set("track", trackId);
    window.history.pushState({}, "", url);
  }

  renderExamTabs();
  renderTrackList();
  els.trackMeta.textContent = "正在载入...";
  els.transcript.innerHTML = '<div class="empty-state">正在载入原文...</div>';

  try {
    const data = await loadTrack(track);
    state.sections = data.sections;
    state.lines = data.lines;
    state.activeIndex = -1;
    state.timingsReady = false;
    renderSections();
    renderTranscript();
    els.trackMeta.textContent = data.status;
    if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
      await applyTimings();
      maybeRestoreTrackViewState();
    }
  } catch (error) {
    console.error(error);
    els.transcript.innerHTML = `<div class="empty-state">没有读到 Markdown 原文，请确认 ${track.markdown} 和网页在同一目录。</div>`;
  }
}

function resetPlaybackState() {
  els.audio.pause();
  els.audio.removeAttribute("src");
  els.audio.load();
  els.progress.value = "0";
  els.currentTime.textContent = "00:00";
  els.duration.textContent = "00:00";
  els.playBtn.textContent = "Play";
  state.activeIndex = -1;
  stopLineLoop();
  state.timingsReady = false;
  state.lastPlaybackStateSaveAt = 0;
  if (els.workspace) {
    els.workspace.scrollTop = 0;
  }
  if (els.sectionNav) {
    els.sectionNav.scrollTop = 0;
  }
  document.querySelector(".line.active")?.classList.remove("active");
  document
    .querySelectorAll(".line.passed")
    .forEach((line) => line.classList.remove("passed"));
}

function renderTrackList() {
  if (!els.trackList) return;

  const fragment = document.createDocumentFragment();
  updateTrackSortButton();
  getOrderedCatalog(state.currentExam).forEach((track) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = track.title;
    button.className = "track-list-item";
    button.classList.toggle(
      "active",
      state.currentTrack &&
        track.id === state.currentTrack.id &&
        track.exam === state.currentTrack.exam,
    );
    button.classList.toggle("unavailable", !track.available);
    // button.disabled = !track.available; // Allow clicking but handle it? 
    // For now, keep the behavior of disabling unavailable ones if they don't even have MD
    
    button.addEventListener("click", () => {
      if (track.available || confirm("该听力暂无对齐时间轴，是否尝试打开？")) {
        switchTrack(track.id, true, track.exam);
      }
    });

    if (!track.available) {
      button.title = "该听力尚未生成时间轴";
    }
    fragment.appendChild(button);
  });

  els.trackList.replaceChildren(fragment);
  restoreTrackListScrollIfNeeded();
}

function getOrderedCatalog(exam = null) {
  const direction = state.trackSortDirection === "desc" ? -1 : 1;
  const catalog = exam ? getCatalogForExam(exam) : state.catalog;
  return [...catalog].sort(
    (a, b) => compareTrackIds(a.id, b.id) * direction,
  );
}

function compareTrackIds(a, b) {
  const left = parseTrackId(a);
  const right = parseTrackId(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return String(a).localeCompare(String(b));
}

function parseTrackId(id) {
  const match = String(id).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return match ? match.slice(1).map(Number) : [9999, 99, 99];
}

function toggleTrackSortDirection() {
  state.trackSortDirection =
    state.trackSortDirection === "asc" ? "desc" : "asc";
  localStorage.setItem(TRACK_SORT_KEY, state.trackSortDirection);
  renderTrackList();
}

function updateTrackSortButton() {
  if (!els.sortTrackList) return;
  const isDesc = state.trackSortDirection === "desc";
  els.sortTrackList.textContent = isDesc ? "逆序" : "顺序";
  els.sortTrackList.title = isDesc ? "切换为顺序显示" : "切换为逆序显示";
  els.sortTrackList.setAttribute(
    "aria-label",
    isDesc ? "当前为逆序显示，切换为顺序显示" : "当前为顺序显示，切换为逆序显示",
  );
}

function normalizeExam(exam) {
  return exam === "cet4" ? "cet4" : DEFAULT_EXAM;
}

function getExamPath(exam = state.currentExam) {
  return `/${normalizeExam(exam)}/`;
}

function getExamFromPathname(pathname = window.location.pathname) {
  const match = String(pathname).match(/^\/(cet4|cet6)(?:\/|$)/i);
  return match ? normalizeExam(match[1].toLowerCase()) : null;
}

function normalizeCatalog(catalog) {
  return Array.isArray(catalog)
    ? catalog.map((track) => ({
        ...track,
        exam: normalizeExam(track?.exam),
      }))
    : [];
}

function getAvailableExams() {
  return Object.keys(EXAM_LABELS);
}

function resolveInitialExam(params) {
  const requestedExam =
    getExamFromPathname(window.location.pathname) ||
    normalizeExam(params.get("exam"));
  const savedExam = normalizeExam(state.browserState.currentExam);

  if (requestedExam) {
    return requestedExam;
  }
  if (savedExam) {
    return savedExam;
  }
  return DEFAULT_EXAM;
}

function renderExamTabs() {
  if (!els.examTabs) return;

  const exams = getAvailableExams();
  els.examTabs.hidden = exams.length <= 1;
  if (exams.length <= 1) {
    els.examTabs.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();
  exams.forEach((exam) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "exam-tab";
    button.textContent = EXAM_LABELS[exam] || exam.toUpperCase();
    button.classList.toggle("active", exam === state.currentExam);
    button.setAttribute("aria-pressed", String(exam === state.currentExam));
    button.addEventListener("click", () => {
      setCurrentExam(exam);
    });
    fragment.appendChild(button);
  });

  els.examTabs.replaceChildren(fragment);
}

function getCatalogForExam(exam = state.currentExam) {
  return state.catalog.filter((track) => track.exam === normalizeExam(exam));
}

function findTrack(trackId, exam = state.currentExam) {
  if (!trackId) return null;
  return (
    getCatalogForExam(exam).find((track) => track.id === trackId) || null
  );
}

async function setCurrentExam(exam, pushState = true) {
  const nextExam = normalizeExam(exam);
  if (nextExam === state.currentExam && state.currentTrack?.exam === nextExam) {
    renderExamTabs();
    return;
  }

  persistCurrentViewState(true);
  state.currentExam = nextExam;
  state.browserState.currentExam = nextExam;
  state.pendingTrackListScrollTop = getSavedTrackListScrollTop(nextExam);

  const orderedCatalog = getOrderedCatalog(nextExam);
  if (!orderedCatalog.length) {
    renderExamTabs();
    renderTrackList();
    renderEmptyExamState(nextExam, pushState);
    return;
  }

  const preferredTrackId =
    getSavedTrackId(nextExam) ||
    (state.currentTrack ? state.currentTrack.id : null);
  const track =
    findTrack(preferredTrackId, nextExam) ||
    orderedCatalog.find((item) => item.available) ||
    orderedCatalog[0];

  if (track) {
    await switchTrack(track.id, pushState, nextExam);
  }
}

function renderEmptyExamState(exam = state.currentExam, pushState = false) {
  state.currentExam = normalizeExam(exam);
  state.currentTrack = null;
  state.sections = [];
  state.lines = [];
  state.activeIndex = -1;
  state.timingsReady = false;
  state.pendingTrackRestore = null;

  resetPlaybackState();
  els.trackName.textContent = EXAM_LABELS[state.currentExam] || state.currentExam;
  els.trackMeta.textContent = "暂无内容";
  els.sectionNav.replaceChildren();
  els.transcript.innerHTML = `<div class="empty-state">当前还没有 ${EXAM_LABELS[state.currentExam] || state.currentExam} 听力材料。</div>`;

  if (pushState) {
    const url = new URL(window.location);
    url.pathname = getExamPath(state.currentExam);
    url.searchParams.delete("track");
    window.history.pushState({}, "", url);
  }
}

function createEmptyBrowserState() {
  return {
    currentExam: DEFAULT_EXAM,
    currentTrackIds: {},
    examTrackListScrollTop: {},
    tracks: {},
  };
}

function loadBrowserState() {
  const savedState = localStorage.getItem(VIEW_STATE_KEY);
  if (!savedState) {
    return createEmptyBrowserState();
  }

  try {
    return sanitizeBrowserState(JSON.parse(savedState));
  } catch {
    localStorage.removeItem(VIEW_STATE_KEY);
    return createEmptyBrowserState();
  }
}

function sanitizeBrowserState(value) {
  const normalized = createEmptyBrowserState();
  if (!value || typeof value !== "object") {
    return normalized;
  }

  if (typeof value.currentExam === "string") {
    normalized.currentExam = normalizeExam(value.currentExam);
  }
  if (typeof value.currentTrackId === "string") {
    normalized.currentTrackIds[DEFAULT_EXAM] = value.currentTrackId;
  }

  if (value.currentTrackIds && typeof value.currentTrackIds === "object") {
    Object.entries(value.currentTrackIds).forEach(([exam, trackId]) => {
      if (typeof trackId === "string") {
        normalized.currentTrackIds[normalizeExam(exam)] = trackId;
      }
    });
  }

  if (Number.isFinite(Number(value.trackListScrollTop))) {
    normalized.examTrackListScrollTop[DEFAULT_EXAM] = toFiniteNumber(
      value.trackListScrollTop,
    );
  }

  if (
    value.examTrackListScrollTop &&
    typeof value.examTrackListScrollTop === "object"
  ) {
    Object.entries(value.examTrackListScrollTop).forEach(([exam, scrollTop]) => {
      normalized.examTrackListScrollTop[normalizeExam(exam)] =
        toFiniteNumber(scrollTop);
    });
  }

  if (!value.tracks || typeof value.tracks !== "object") {
    return normalized;
  }

  Object.entries(value.tracks).forEach(([trackId, trackState]) => {
    if (!trackState || typeof trackState !== "object") {
      return;
    }

    normalized.tracks[trackId] = {
      audioTime: toFiniteNumber(trackState.audioTime),
      workspaceScrollTop: toFiniteNumber(trackState.workspaceScrollTop),
      sectionNavScrollTop: toFiniteNumber(trackState.sectionNavScrollTop),
    };
  });

  return normalized;
}

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundPlaybackTime(value) {
  return Math.max(0, Math.round(toFiniteNumber(value) * 10) / 10);
}

function getSavedTrackId(exam = state.currentExam) {
  const trackId = state.browserState.currentTrackIds[normalizeExam(exam)];
  return typeof trackId === "string"
    ? trackId
    : null;
}

function getSavedTrackListScrollTop(exam = state.currentExam) {
  return toFiniteNumber(
    state.browserState.examTrackListScrollTop[normalizeExam(exam)],
  );
}

function getTrackStateKey(trackId, exam = state.currentExam) {
  return `${normalizeExam(exam)}:${trackId}`;
}

function getTrackViewState(trackId, exam = state.currentExam) {
  return state.browserState.tracks[getTrackStateKey(trackId, exam)] || null;
}

function ensureTrackViewState(trackId, exam = state.currentExam) {
  if (!trackId) return null;
  const key = getTrackStateKey(trackId, exam);

  if (!state.browserState.tracks[key]) {
    state.browserState.tracks[key] = {
      audioTime: 0,
      workspaceScrollTop: 0,
      sectionNavScrollTop: 0,
    };
  }

  return state.browserState.tracks[key];
}

function createPendingTrackRestore(trackId, exam = state.currentExam) {
  const trackState = getTrackViewState(trackId, exam);
  return {
    trackId,
    exam: normalizeExam(exam),
    audioTime: toFiniteNumber(trackState?.audioTime),
    workspaceScrollTop: toFiniteNumber(trackState?.workspaceScrollTop),
    sectionNavScrollTop: toFiniteNumber(trackState?.sectionNavScrollTop),
  };
}

function captureGlobalViewState() {
  state.browserState.currentExam = normalizeExam(state.currentExam);
  if (state.currentTrack?.id && state.currentTrack?.exam) {
    state.browserState.currentTrackIds[state.currentTrack.exam] =
      state.currentTrack.id;
  }
  if (els.trackList) {
    state.browserState.examTrackListScrollTop[normalizeExam(state.currentExam)] =
      Math.round(els.trackList.scrollTop);
  }
}

function captureCurrentTrackViewState() {
  const trackId = state.currentTrack?.id;
  const exam = state.currentTrack?.exam;
  if (!trackId) return;

  const trackState = ensureTrackViewState(trackId, exam);
  trackState.audioTime = roundPlaybackTime(els.audio.currentTime);
  trackState.workspaceScrollTop = Math.round(els.workspace?.scrollTop || 0);
  trackState.sectionNavScrollTop = Math.round(els.sectionNav?.scrollTop || 0);
}

function scheduleBrowserStateSave(delay = 160) {
  window.clearTimeout(state.browserStateSaveTimer);
  state.browserStateSaveTimer = window.setTimeout(() => {
    state.browserStateSaveTimer = 0;
    saveBrowserState();
  }, delay);
}

function saveBrowserState() {
  if (state.browserStateSaveTimer) {
    window.clearTimeout(state.browserStateSaveTimer);
    state.browserStateSaveTimer = 0;
  }

  localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state.browserState));
}

function persistCurrentViewState(force = false) {
  captureGlobalViewState();
  captureCurrentTrackViewState();

  if (force) {
    saveBrowserState();
    return;
  }

  scheduleBrowserStateSave();
}

function persistPlaybackState(force = false) {
  const now = Date.now();
  if (!force && now - state.lastPlaybackStateSaveAt < 1000) {
    return;
  }

  state.lastPlaybackStateSaveAt = now;
  persistCurrentViewState(force);
}

function restoreTrackListScrollIfNeeded() {
  if (!els.trackList || state.pendingTrackListScrollTop === null) return;

  const scrollTop = Math.max(0, state.pendingTrackListScrollTop);
  state.pendingTrackListScrollTop = null;
  requestAnimationFrame(() => {
    els.trackList.scrollTop = scrollTop;
  });
}

function maybeRestoreTrackViewState() {
  const pendingState = state.pendingTrackRestore;
  if (
    !pendingState ||
    pendingState.trackId !== state.currentTrack?.id ||
    pendingState.exam !== state.currentTrack?.exam
  ) {
    return false;
  }

  if (
    !state.lines.length ||
    !state.timingsReady ||
    !Number.isFinite(els.audio.duration) ||
    els.audio.duration <= 0
  ) {
    return false;
  }

  const targetTime = clamp(
    toFiniteNumber(pendingState.audioTime),
    0,
    els.audio.duration,
  );
  els.audio.currentTime = targetTime;
  updateProgress();
  updateFromTime(targetTime, { suppressAutoScroll: true });

  requestAnimationFrame(() => {
    if (
      state.currentTrack?.id !== pendingState.trackId ||
      state.currentTrack?.exam !== pendingState.exam
    ) {
      return;
    }

    if (els.workspace) {
      els.workspace.scrollTop = Math.max(0, pendingState.workspaceScrollTop);
    }
    if (els.sectionNav) {
      els.sectionNav.scrollTop = Math.max(0, pendingState.sectionNavScrollTop);
    }
  });

  state.pendingTrackRestore = null;
  return true;
}

async function fetchText(path) {
  const response = await fetch(encodeURI(path));
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.text();
}

async function fetchJson(path) {
  const response = await fetch(encodeURI(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

async function loadTrack(track) {
  if (track.transcript) {
    try {
      const transcript = await fetchJson(track.transcript);
      if (
        Array.isArray(transcript.sections) &&
        Array.isArray(transcript.lines)
      ) {
        await mergeSupplementalLineData(track, transcript.lines);
        return {
          sections: transcript.sections,
          lines: transcript.lines,
          status: `${transcript.lines.length} 行原文 · 标准 transcript JSON`,
        };
      }
    } catch (error) {
      console.info(
        "Transcript JSON unavailable, falling back to Markdown.",
        error,
      );
    }
  }

  const markdown = await fetchText(track.markdown);
  const parsed = parseMarkdown(markdown);
  await mergeSupplementalLineData(track, parsed.lines);
  return {
    sections: parsed.sections,
    lines: parsed.lines,
    status: `${parsed.lines.length} 行原文 · 浏览器估算时间轴`,
  };
}

async function mergeSupplementalLineData(track, lines) {
  if (!track.timings || !Array.isArray(lines)) return;

  try {
    const data = await fetchJson(track.timings);
    const rows = getExternalLineRows(data);
    if (Array.isArray(rows)) {
      mergeLineRows(rows, lines);
    }
  } catch (error) {
    console.info("Timing JSON unavailable for supplemental line data.", error);
  }
}

function bindEvents() {
  bindLayoutEvents();
  bindFloatingPlayer();

  if (els.translationVisible) {
    els.translationVisible.checked = state.translationVisible;
  }

  els.audio.addEventListener("loadedmetadata", async () => {
    els.duration.textContent = formatTime(els.audio.duration);
    await applyTimings();
    if (!maybeRestoreTrackViewState()) {
      updateFromTime();
    }
  });

  els.audio.addEventListener("timeupdate", () => {
    if (!state.userSeeking) {
      updateProgress();
    }
    updateFromTime();
    enforceLineLoop();
    persistPlaybackState();
  });

  els.audio.addEventListener("seeked", () => {
    updateProgress();
    updateFromTime();
    persistPlaybackState(true);
  });

  els.audio.addEventListener("play", () => {
    els.playBtn.textContent = "Pause";
    startLineLoopMonitor();
    persistCurrentViewState();
  });

  els.audio.addEventListener("pause", () => {
    els.playBtn.textContent = "Play";
    stopLineLoopMonitor();
    persistPlaybackState(true);
  });

  els.audio.addEventListener("ended", () => {
    restartLineLoop();
    persistPlaybackState(true);
  });

  els.playBtn.addEventListener("click", () => {
    if (els.audio.paused) {
      els.audio.play();
    } else {
      els.audio.pause();
    }
  });

  els.backBtn.addEventListener("click", () => seekBy(-5));
  els.forwardBtn.addEventListener("click", () => seekBy(5));
  els.sortTrackList?.addEventListener("click", toggleTrackSortDirection);
  els.transcriptVisible?.addEventListener("change", () => {
    els.workspace.hidden = !els.transcriptVisible.checked;
  });
  els.translationVisible?.addEventListener("change", () => {
    state.translationVisible = els.translationVisible.checked;
    localStorage.setItem(
      TRANSLATION_VISIBLE_KEY,
      String(state.translationVisible),
    );
    renderTranscript();
  });

  els.progress.addEventListener("pointerdown", () => {
    stopLineLoop();
    state.userSeeking = true;
  });

  els.progress.addEventListener("input", () => {
    state.userSeeking = true;
    seekToProgress();
  });

  els.progress.addEventListener("change", () => {
    seekToProgress();
    state.userSeeking = false;
  });

  els.progress.addEventListener("pointerup", () => {
    seekToProgress();
    state.userSeeking = false;
  });

  els.progress.addEventListener("pointercancel", () => {
    seekToProgress();
    state.userSeeking = false;
  });

  els.trackList?.addEventListener(
    "scroll",
    () => {
      captureGlobalViewState();
      scheduleBrowserStateSave();
    },
    { passive: true },
  );

  els.workspace?.addEventListener(
    "scroll",
    () => {
      captureCurrentTrackViewState();
      scheduleBrowserStateSave();
    },
    { passive: true },
  );

  els.sectionNav?.addEventListener(
    "scroll",
    () => {
      captureCurrentTrackViewState();
      scheduleBrowserStateSave();
    },
    { passive: true },
  );

  document.querySelectorAll(".speed").forEach((button) => {
    button.addEventListener("click", () => {
      const speed = Number(button.dataset.speed);
      els.audio.playbackRate = speed;
      document
        .querySelectorAll(".speed")
        .forEach((item) => item.classList.toggle("active", item === button));
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;

    if (event.code === "Space") {
      event.preventDefault();
      els.playBtn.click();
    }

    if (event.key === "ArrowLeft") seekBy(-5);
    if (event.key === "ArrowRight") seekBy(5);
  });

  window.addEventListener("pagehide", () => {
    persistCurrentViewState(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persistCurrentViewState(true);
    }
  });
}

function bindFloatingPlayer() {
  if (!els.nowPlaying) return;

  els.pinPlayer?.addEventListener("click", () => {
    setPlayerPinned(!state.playerPinned);
  });

  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  els.nowPlaying.addEventListener("pointerdown", (event) => {
    if (
      state.playerPinned ||
      event.button !== 0 ||
      event.target.closest("button, input, label")
    ) {
      return;
    }

    event.preventDefault();
    els.nowPlaying.setPointerCapture(event.pointerId);
    els.nowPlaying.classList.add("dragging");

    const rect = els.nowPlaying.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    const movePlayer = (moveEvent) => {
      setPlayerPosition(
        startLeft + moveEvent.clientX - startX,
        startTop + moveEvent.clientY - startY,
        rect,
      );
    };

    const stopDrag = () => {
      els.nowPlaying.classList.remove("dragging");
      savePlayerPosition();
      els.nowPlaying.removeEventListener("pointermove", movePlayer);
      els.nowPlaying.removeEventListener("pointerup", stopDrag);
      els.nowPlaying.removeEventListener("pointercancel", stopDrag);
    };

    els.nowPlaying.addEventListener("pointermove", movePlayer);
    els.nowPlaying.addEventListener("pointerup", stopDrag);
    els.nowPlaying.addEventListener("pointercancel", stopDrag);
  });
}

function restorePlayerPosition() {
  if (!els.nowPlaying) return;

  const savedPosition = localStorage.getItem(PLAYER_POSITION_KEY);
  if (!savedPosition) return;

  try {
    const position = JSON.parse(savedPosition);
    if (!Number.isFinite(position.left) || !Number.isFinite(position.top)) {
      return;
    }

    const rect = els.nowPlaying.getBoundingClientRect();
    setPlayerPosition(position.left, position.top, rect);
  } catch (error) {
    localStorage.removeItem(PLAYER_POSITION_KEY);
  }
}

function savePlayerPosition() {
  if (!els.nowPlaying) return;

  const rect = els.nowPlaying.getBoundingClientRect();
  localStorage.setItem(
    PLAYER_POSITION_KEY,
    JSON.stringify({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
    }),
  );
}

function setPlayerPosition(
  left,
  top,
  rect = els.nowPlaying.getBoundingClientRect(),
) {
  const maxLeft = Math.max(12, window.innerWidth - rect.width - 12);
  const maxTop = Math.max(0, window.innerHeight - rect.height);

  els.nowPlaying.style.left = `${clamp(left, 12, maxLeft)}px`;
  els.nowPlaying.style.top = `${clamp(top, 0, maxTop)}px`;
  els.nowPlaying.style.right = "auto";
  els.nowPlaying.style.bottom = "auto";
  els.nowPlaying.style.transform = "none";
}

function restorePlayerPinned() {
  setPlayerPinned(localStorage.getItem(PLAYER_PINNED_KEY) === "true", false);
}

function setPlayerPinned(pinned, persist = true) {
  state.playerPinned = pinned;
  els.nowPlaying?.classList.toggle("pinned", pinned);
  if (persist) {
    localStorage.setItem(PLAYER_PINNED_KEY, String(pinned));
  }
  if (!els.pinPlayer) return;

  els.pinPlayer.setAttribute("aria-pressed", String(pinned));
  els.pinPlayer.setAttribute(
    "aria-label",
    pinned ? "取消固定播放器" : "固定播放器",
  );
  els.pinPlayer.title = pinned ? "取消固定播放器" : "固定播放器";
}

function bindLayoutEvents() {
  els.hideLeftSidebar?.addEventListener("click", () =>
    setSidebarCollapsed("left", true),
  );
  els.showLeftSidebar?.addEventListener("click", () =>
    setSidebarCollapsed("left", false),
  );
  els.hideRightSidebar?.addEventListener("click", () =>
    setSidebarCollapsed("right", true),
  );
  els.showRightSidebar?.addEventListener("click", () =>
    setSidebarCollapsed("right", false),
  );

  bindSidebarResizer(els.leftResizer, "left");
  bindSidebarResizer(els.rightResizer, "right");
}

function restoreLayoutState() {
  const leftWidth = Number(localStorage.getItem("cet6-left-sidebar-width"));
  const rightWidth = Number(localStorage.getItem("cet6-right-sidebar-width"));
  const leftCollapsed =
    localStorage.getItem("cet6-left-sidebar-collapsed") === "true";
  const rightCollapsed =
    localStorage.getItem("cet6-right-sidebar-collapsed") === "true";

  if (Number.isFinite(leftWidth) && leftWidth > 0) {
    setSidebarWidth("left", leftWidth);
  }
  if (Number.isFinite(rightWidth) && rightWidth > 0) {
    setSidebarWidth("right", rightWidth);
  }
  setSidebarCollapsed("left", leftCollapsed, false);
  setSidebarCollapsed("right", rightCollapsed, false);
}

function bindSidebarResizer(handle, side) {
  if (!handle || !els.shell) return;

  handle.addEventListener("pointerdown", (event) => {
    if (side === "left" && els.shell.classList.contains("left-collapsed"))
      return;
    if (side === "right" && els.shell.classList.contains("right-collapsed"))
      return;

    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");
    document.body.classList.add("resizing");

    const startX = event.clientX;
    const startWidth = getSidebarWidth(side);

    const onPointerMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const width = side === "left" ? startWidth + delta : startWidth - delta;
      setSidebarWidth(side, width, true);
    };

    const stopResize = () => {
      handle.classList.remove("active");
      document.body.classList.remove("resizing");
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", stopResize);
      handle.removeEventListener("pointercancel", stopResize);
    };

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", stopResize);
    handle.addEventListener("pointercancel", stopResize);
  });
}

function setSidebarCollapsed(side, collapsed, persist = true) {
  const className = side === "left" ? "left-collapsed" : "right-collapsed";
  els.shell?.classList.toggle(className, collapsed);
  if (persist) {
    localStorage.setItem(`cet6-${side}-sidebar-collapsed`, String(collapsed));
  }
}

function getSidebarWidth(side) {
  const variable =
    side === "left" ? "--left-sidebar-width" : "--right-sidebar-width";
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    variable,
  );
  return Number.parseFloat(value) || (side === "left" ? 280 : 300);
}

function setSidebarWidth(side, width, persist = false) {
  const min = side === "left" ? 180 : 220;
  const max = side === "left" ? 420 : 460;
  const nextWidth = clamp(Math.round(width), min, max);
  const variable =
    side === "left" ? "--left-sidebar-width" : "--right-sidebar-width";

  document.documentElement.style.setProperty(variable, `${nextWidth}px`);
  if (persist) {
    localStorage.setItem(`cet6-${side}-sidebar-width`, String(nextWidth));
  }
}

function parseMarkdown(markdown) {
  const sections = [];
  const lines = [];
  let currentSection = null;

  markdown.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const heading = line.match(/^##\s+(.+)/);
    if (heading) {
      currentSection = {
        id: slugify(heading[1]),
        title: heading[1].trim(),
        firstLineId: null,
      };
      sections.push(currentSection);
      return;
    }

    if (!currentSection) {
      currentSection = {
        id: "intro",
        title: "INTRO",
        firstLineId: null,
      };
      sections.push(currentSection);
    }

    const parsedLines = splitTranscriptLine(cleanMojibake(line));
    parsedLines.forEach((item) => {
      const id = `line-${lines.length}`;
      if (!currentSection.firstLineId) {
        currentSection.firstLineId = id;
      }
      lines.push({
        id,
        sectionId: currentSection.id,
        sectionTitle: currentSection.title,
        speaker: item.speaker,
        text: item.text,
        type: item.type,
        words: countWords(item.text),
        start: 0,
        end: 0,
      });
    });
  });

  return { sections, lines };
}

function splitTranscriptLine(line) {
  const question = line.match(/^(Q\d+\.)\s*(.+)$/);
  if (question) {
    return [
      {
        speaker: question[1],
        text: question[2],
        type: "question",
      },
    ];
  }

  const speaker = line.match(/^([A-Z]):\s*(.+)$/);
  if (speaker) {
    return splitSentences(speaker[2]).map((text) => ({
      speaker: `${speaker[1]}:`,
      text,
      type: "dialogue",
    }));
  }

  return splitSentences(line).map((text) => ({
    speaker: "",
    text,
    type: "narration",
  }));
}

function splitSentences(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const guarded = normalized
    .replace(/\b(?:[A-Z]\.){2,}/g, (match) => match.replace(/\./g, "__DOT__"))
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|St|No|vs|etc)\./gi, "$1__DOT__");
  const chunks = guarded.match(/[^.!?]+(?:[.!?]+["']?|$)/g) || [guarded];
  return chunks
    .map((chunk) => chunk.replace(/__DOT__/g, ".").trim())
    .filter(Boolean);
}

function cleanMojibake(text) {
  return text
    .replace(/\s*鈥\?\s*/g, " - ")
    .replace(/鈥檚/g, "'s")
    .replace(/鈥檛/g, "'t")
    .replace(/鈥檙/g, "'r")
    .replace(/鈥渢/g, '"t')
    .replace(/鈥/g, "'");
}

function countWords(text) {
  const matches = text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g);
  return matches ? matches.length : Math.max(1, Math.ceil(text.length / 4));
}

async function applyTimings() {
  if (
    state.timingsReady ||
    !Number.isFinite(els.audio.duration) ||
    els.audio.duration <= 0 ||
    !state.lines.length
  )
    return;

  let externalTimings = null;
  try {
    const response = await fetch(encodeURI(state.currentTrack.timings), {
      cache: "no-store",
    });
    if (response.ok) {
      externalTimings = await response.json();
    }
  } catch {
    externalTimings = null;
  }

  if (externalTimings) {
    mergeExternalTimings(externalTimings);
    els.trackMeta.textContent = `${state.lines.length} 行原文 · 已载入时间轴`;
  } else {
    buildAutoTimings(els.audio.duration);
    els.trackMeta.textContent = `${state.lines.length} 行原文 · 自动估算时间轴`;
  }

  state.timingsReady = true;
  renderTranscript();
}

function normalizeLineEnds(duration) {
  state.lines.forEach((line, index) => {
    line.start = Number(line.start) || 0;
    const next = state.lines[index + 1];
    line.end =
      Number(line.end) ||
      (next ? Number(next.start) || line.start + 1 : duration);
  });
}

function mergeExternalTimings(data) {
  const rows = getExternalLineRows(data);
  if (!Array.isArray(rows)) {
    buildAutoTimings(els.audio.duration);
    return;
  }

  mergeLineRows(rows, state.lines, true);
}

function getExternalLineRows(data) {
  return Array.isArray(data) ? data : data?.lines;
}

function mergeLineRows(rows, lines, includeTimings = false) {
  rows.forEach((row, index) => {
    const line =
      typeof row.id === "string"
        ? lines.find((item) => item.id === row.id)
        : lines[index];

    if (!line) return;
    if (includeTimings) {
      line.start = Number(row.start) || 0;
      line.end = Number(row.end) || line.start + 1;
    }
    if (typeof row.translation === "string" && row.translation.trim()) {
      line.translation = row.translation;
    }
  });
}

function buildAutoTimings(duration) {
  const sectionGaps = new Set(
    state.sections.map((section) => section.firstLineId).filter(Boolean),
  );
  const weights = state.lines.map((line) => timingWeight(line, sectionGaps));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;

  state.lines.forEach((line, index) => {
    const lineDuration = duration * (weights[index] / totalWeight);
    line.start = cursor;
    line.end =
      index === state.lines.length - 1 ? duration : cursor + lineDuration;
    cursor = line.end;
  });
}

function timingWeight(line, sectionGaps = null) {
  const sectionStart =
    sectionGaps ||
    new Set(
      state.sections.map((section) => section.firstLineId).filter(Boolean),
    );
  const base = Math.max(4, line.words);
  const questionWeight = line.type === "question" ? 9 : 0;
  const sectionWeight = sectionStart.has(line.id) ? 10 : 0;
  return base + questionWeight + sectionWeight;
}

function renderSections() {
  els.sectionNav.innerHTML = "";
  state.sections.forEach((section) => {
    const item = document.createElement("div");
    item.className = "section-nav-item";
    item.dataset.sectionId = section.id;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "section-jump";
    button.textContent = titleCase(section.title);
    button.dataset.sectionId = section.id;
    button.addEventListener("click", () => {
      const firstLine = getFirstLineForSection(section);
      if (!firstLine) return;
      document
        .getElementById(firstLine.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    blurAfterPointerActivation(button);

    const firstLine = getFirstLineForSection(section);
    const actions = document.createElement("span");
    actions.className = "section-actions";

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "line-play section-action";
    playButton.title = "播放这一句";
    playButton.setAttribute(
      "aria-label",
      firstLine ? `播放：${firstLine.text}` : `播放：${section.title}`,
    );

    const playIcon = document.createElement("span");
    playIcon.className = "line-play-icon";
    playIcon.setAttribute("aria-hidden", "true");
    playButton.appendChild(playIcon);
    playButton.addEventListener("click", () => {
      if (!firstLine) return;
      seekToLine(firstLine);
      document
        .getElementById(firstLine.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    blurAfterPointerActivation(playButton);

    const loopButton = document.createElement("button");
    loopButton.type = "button";
    loopButton.className = "line-play line-loop section-action";
    loopButton.dataset.lineId = firstLine?.id || "";
    loopButton.title = "循环播放这一句";
    loopButton.setAttribute(
      "aria-label",
      firstLine ? `循环播放：${firstLine.text}` : `循环播放：${section.title}`,
    );
    loopButton.setAttribute(
      "aria-pressed",
      String(firstLine && state.loopLineId === firstLine.id),
    );
    loopButton.classList.toggle(
      "active",
      Boolean(firstLine && state.loopLineId === firstLine.id),
    );

    const loopIcon = document.createElement("span");
    loopIcon.className = "line-loop-icon";
    loopIcon.setAttribute("aria-hidden", "true");
    loopButton.appendChild(loopIcon);
    loopButton.addEventListener("click", () => {
      if (!firstLine) return;
      toggleLineLoop(firstLine);
      document
        .getElementById(firstLine.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    blurAfterPointerActivation(loopButton);

    if (!firstLine) {
      playButton.disabled = true;
      loopButton.disabled = true;
    }

    actions.append(playButton, loopButton);
    item.append(button, actions);
    els.sectionNav.appendChild(item);
  });
}

function getFirstLineForSection(section) {
  return (
    state.lines.find((line) => line.id === section.firstLineId) ||
    state.lines.find((line) => line.sectionId === section.id)
  );
}

function blurAfterPointerActivation(button) {
  let pointerActivated = false;
  button.addEventListener("pointerdown", () => {
    pointerActivated = true;
  });
  button.addEventListener("click", () => {
    if (!pointerActivated) return;

    button.blur();
    pointerActivated = false;
  });
}

function renderTranscript() {
  if (!state.lines.length) return;

  const fragment = document.createDocumentFragment();
  let currentSection = "";

  state.lines.forEach((line) => {
    if (line.sectionTitle !== currentSection) {
      currentSection = line.sectionTitle;
      const heading = document.createElement("div");
      heading.className = "section-heading";
      heading.textContent = titleCase(currentSection);
      fragment.appendChild(heading);
    }

    const row = document.createElement("div");
    row.id = line.id;
    row.className = `line ${line.type}`;
    row.dataset.index = String(state.lines.indexOf(line));
    row.classList.toggle("looping", state.loopLineId === line.id);

    const time = document.createElement("span");
    time.className = "line-time";
    time.textContent = state.timingsReady ? formatTime(line.start) : "--:--";

    const text = document.createElement("span");
    text.className = "line-text";

    const original = document.createElement("span");
    original.className = "line-original";

    if (line.speaker) {
      const speaker = document.createElement("span");
      speaker.className = "speaker";
      speaker.textContent = line.speaker;
      original.appendChild(speaker);
    }

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "line-play";
    playButton.title = "播放这一句";
    playButton.setAttribute("aria-label", `播放：${line.text}`);

    const playIcon = document.createElement("span");
    playIcon.className = "line-play-icon";
    playIcon.setAttribute("aria-hidden", "true");
    playButton.appendChild(playIcon);
    let pointerActivated = false;
    playButton.addEventListener("pointerdown", () => {
      pointerActivated = true;
    });
    playButton.addEventListener("click", () => {
      seekToLine(line);
      if (pointerActivated) {
        playButton.blur();
        pointerActivated = false;
      }
    });

    const loopButton = document.createElement("button");
    loopButton.type = "button";
    loopButton.className = "line-play line-loop";
    loopButton.dataset.lineId = line.id;
    loopButton.title = "循环播放这一句";
    loopButton.setAttribute("aria-label", `循环播放：${line.text}`);
    loopButton.setAttribute(
      "aria-pressed",
      String(state.loopLineId === line.id),
    );
    loopButton.classList.toggle("active", state.loopLineId === line.id);

    const loopIcon = document.createElement("span");
    loopIcon.className = "line-loop-icon";
    loopIcon.setAttribute("aria-hidden", "true");
    loopButton.appendChild(loopIcon);
    let loopPointerActivated = false;
    loopButton.addEventListener("pointerdown", () => {
      loopPointerActivated = true;
    });
    loopButton.addEventListener("click", () => {
      toggleLineLoop(line);
      if (loopPointerActivated) {
        loopButton.blur();
        loopPointerActivated = false;
      }
    });

    const actions = document.createElement("span");
    actions.className = "line-actions";
    actions.append(playButton, loopButton);

    original.append(document.createTextNode(line.text));
    text.appendChild(original);

    if (state.translationVisible && line.translation) {
      const translation = document.createElement("span");
      translation.className = "line-translation";
      translation.textContent = line.translation;
      text.appendChild(translation);
    }

    row.append(time, text, actions);
    fragment.appendChild(row);
  });

  els.transcript.replaceChildren(fragment);
  updateFromTime();
}

function updateProgress() {
  if (!Number.isFinite(els.audio.duration) || els.audio.duration <= 0) return;
  els.progress.value = String(
    (els.audio.currentTime / els.audio.duration) * 1000,
  );
  els.currentTime.textContent = formatTime(els.audio.currentTime);
}

function progressToTime() {
  if (!Number.isFinite(els.audio.duration)) return 0;
  return (Number(els.progress.value) / 1000) * els.audio.duration;
}

function seekToProgress() {
  const time = progressToTime();
  els.audio.currentTime = time;
  els.currentTime.textContent = formatTime(time);
  updateFromTime(time);
}

function updateFromTime(timeOverride = null, options = {}) {
  if (!state.timingsReady || !state.lines.length) return;

  const sourceTime = Number.isFinite(timeOverride)
    ? timeOverride
    : els.audio.currentTime;
  const transcriptTime = clamp(sourceTime, 0, els.audio.duration || 0);
  const index = findActiveLineIndex(transcriptTime);
  if (index === state.activeIndex) return;

  const previous = document.querySelector(".line.active");
  previous?.classList.remove("active");

  document
    .querySelectorAll(".line.passed")
    .forEach((line) => line.classList.remove("passed"));

  state.activeIndex = index;
  const activeLine = state.lines[index];
  if (!activeLine) return;

  const activeEl = document.getElementById(activeLine.id);
  activeEl?.classList.add("active");

  state.lines
    .slice(0, index)
    .forEach((line) =>
      document.getElementById(line.id)?.classList.add("passed"),
    );

  document.querySelectorAll(".section-nav-item").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.sectionId === activeLine.sectionId,
    );
  });

  if (els.autoScroll.checked && activeEl && !options.suppressAutoScroll) {
    activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function findActiveLineIndex(time) {
  let low = 0;
  let high = state.lines.length - 1;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const line = state.lines[mid];

    if (time < line.start) {
      high = mid - 1;
    } else {
      best = mid;
      if (time < line.end) break;
      low = mid + 1;
    }
  }

  return best;
}

function toggleLineLoop(line) {
  if (state.loopLineId === line.id) {
    stopLineLoop();
    return;
  }

  startLineLoop(line);
}

function startLineLoop(line) {
  state.loopLineId = line.id;
  updateLineLoopControls();
  seekToLine(line, { preserveLoop: true });
  startLineLoopMonitor();
}

function stopLineLoop() {
  if (!state.loopLineId && lineLoopFrameId === null) return;

  state.loopLineId = null;
  stopLineLoopMonitor();
  updateLineLoopControls();
}

function updateLineLoopControls() {
  document.querySelectorAll(".line-loop").forEach((button) => {
    const active = button.dataset.lineId === state.loopLineId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.closest(".section-nav-item")?.classList.toggle("looping", active);
  });

  document
    .querySelectorAll(".line.looping")
    .forEach((row) => row.classList.remove("looping"));

  if (state.loopLineId) {
    document.getElementById(state.loopLineId)?.classList.add("looping");
  }
}

function startLineLoopMonitor() {
  if (lineLoopFrameId !== null || !state.loopLineId || els.audio.paused) {
    return;
  }

  lineLoopFrameId = requestAnimationFrame(checkLineLoop);
}

function stopLineLoopMonitor() {
  if (lineLoopFrameId === null) return;

  cancelAnimationFrame(lineLoopFrameId);
  lineLoopFrameId = null;
}

function checkLineLoop() {
  lineLoopFrameId = null;
  if (!state.loopLineId || els.audio.paused) return;

  enforceLineLoop();
  startLineLoopMonitor();
}

function enforceLineLoop() {
  if (!state.loopLineId || state.userSeeking) return;

  const line = state.lines.find((item) => item.id === state.loopLineId);
  if (!line) {
    stopLineLoop();
    return;
  }

  const { start, end } = getLineLoopBounds(line);
  if (end <= start) return;

  if (els.audio.currentTime >= end) {
    els.audio.currentTime = start;
    updateProgress();
    updateFromTime(start);
  }
}

function restartLineLoop() {
  if (!state.loopLineId) return;

  const line = state.lines.find((item) => item.id === state.loopLineId);
  if (!line) {
    stopLineLoop();
    return;
  }

  const { start } = getLineLoopBounds(line);
  els.audio.currentTime = start;
  els.audio.play();
}

function getLineLoopBounds(line) {
  const duration =
    Number.isFinite(els.audio.duration) && els.audio.duration > 0
      ? els.audio.duration
      : null;
  const fallbackLimit = [Number(line.end), Number(line.start)].find((value) =>
    Number.isFinite(value),
  );
  const startLimit = duration ?? fallbackLimit ?? 0;
  const start = clamp(Number(line.start) || 0, 0, startLimit);
  let end = Number(line.end);

  if (!Number.isFinite(end) || end <= start) {
    const nextLine = state.lines[state.lines.indexOf(line) + 1];
    end = Number(nextLine?.start);
  }

  if (!Number.isFinite(end) || end <= start) {
    end = start + 1;
  }

  if (duration !== null) {
    end = clamp(end, start, duration);
  }

  return { start, end };
}

function seekToLine(line, options = {}) {
  if (!options.preserveLoop) {
    stopLineLoop();
  }

  const target = clamp(line.start, 0, els.audio.duration || line.start);
  els.audio.currentTime = target;
  updateProgress();
  updateFromTime();
  if (els.audio.paused) {
    els.audio.play();
  }
}

function seekBy(seconds) {
  stopLineLoop();
  els.audio.currentTime = clamp(
    els.audio.currentTime + seconds,
    0,
    els.audio.duration || 0,
  );
  updateProgress();
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "00:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function titleCase(text) {
  return text
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
