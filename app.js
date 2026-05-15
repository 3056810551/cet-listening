const SOURCE = {
  markdown: "2025-12-1.md",
  audio: "2025年12月六级听力音频第1套.mp3",
  timings: "2025-12-1.timings.json",
  title: "2025 年 12 月 六级听力第 1 套",
};

const TRACK_CATALOG = [
  {
    label: "2025年12月CET6听力第1套",
    markdown: SOURCE.markdown,
    audio: SOURCE.audio,
    available: true,
  },
];

const state = {
  sections: [],
  lines: [],
  activeIndex: -1,
  timingsReady: false,
  userSeeking: false,
  backendTrack: null,
};

const els = {
  shell: document.querySelector("#shell"),
  audio: document.querySelector("#audio"),
  playBtn: document.querySelector("#playBtn"),
  backBtn: document.querySelector("#backBtn"),
  forwardBtn: document.querySelector("#forwardBtn"),
  progress: document.querySelector("#progress"),
  currentTime: document.querySelector("#currentTime"),
  duration: document.querySelector("#duration"),
  trackList: document.querySelector("#trackList"),
  sectionNav: document.querySelector("#sectionNav"),
  transcript: document.querySelector("#transcript"),
  trackName: document.querySelector("#trackName"),
  trackMeta: document.querySelector("#trackMeta"),
  autoScroll: document.querySelector("#autoScroll"),
  workspace: document.querySelector(".workspace"),
  transcriptVisible: document.querySelector("#transcriptVisible"),
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
  els.trackName.textContent = SOURCE.title;
  els.audio.src = encodeURI(SOURCE.audio);
  renderTrackList();
  bindEvents();

  try {
    const track = await loadTrack();
    state.backendTrack = track.backend ? track : null;
    state.sections = track.sections;
    state.lines = track.lines;
    renderSections();
    renderTranscript();
    els.trackMeta.textContent = track.status;
  } catch (error) {
    console.error(error);
    els.transcript.innerHTML = `<div class="empty-state">没有读到 Markdown 原文，请确认 ${SOURCE.markdown} 和网页在同一目录。</div>`;
  }
}

function renderTrackList() {
  if (!els.trackList) return;

  const fragment = document.createDocumentFragment();
  TRACK_CATALOG.forEach((track) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = track.label;
    button.className = "track-list-item";
    button.classList.toggle(
      "active",
      track.markdown === SOURCE.markdown && track.audio === SOURCE.audio,
    );
    button.classList.toggle("unavailable", !track.available);
    button.disabled = !track.available;
    if (!track.available) {
      button.title = "把对应的 md 和音频放进目录后会自动启用";
    }
    fragment.appendChild(button);
  });

  els.trackList.replaceChildren(fragment);
}

async function fetchText(path) {
  const response = await fetch(encodeURI(path));
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.text();
}

async function loadTrack() {
  try {
    const response = await fetch(
      `/api/track?markdown=${encodeURIComponent(SOURCE.markdown)}&audio=${encodeURIComponent(SOURCE.audio)}`,
      {
        cache: "no-store",
      },
    );

    if (response.ok) {
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return {
        backend: true,
        sections: data.sections,
        lines: data.lines,
        status: describeBackendStatus(data),
      };
    }
  } catch (error) {
    console.info(
      "Backend timing unavailable, falling back to browser estimate.",
      error,
    );
  }

  const markdown = await fetchText(SOURCE.markdown);
  const parsed = parseMarkdown(markdown);
  return {
    backend: false,
    sections: parsed.sections,
    lines: parsed.lines,
    status: `${parsed.lines.length} 行原文 · 浏览器估算时间轴`,
  };
}

function bindEvents() {
  bindLayoutEvents();

  els.audio.addEventListener("loadedmetadata", async () => {
    els.duration.textContent = formatTime(els.audio.duration);
    await applyTimings();
    updateFromTime();
  });

  els.audio.addEventListener("timeupdate", () => {
    if (!state.userSeeking) {
      updateProgress();
    }
    updateFromTime();
  });

  els.audio.addEventListener("seeked", () => {
    updateProgress();
    updateFromTime();
  });

  els.audio.addEventListener("play", () => {
    els.playBtn.textContent = "Pause";
  });

  els.audio.addEventListener("pause", () => {
    els.playBtn.textContent = "Play";
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
  els.transcriptVisible?.addEventListener("change", () => {
    els.workspace.hidden = !els.transcriptVisible.checked;
  });

  els.progress.addEventListener("pointerdown", () => {
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
    !Number.isFinite(els.audio.duration) ||
    els.audio.duration <= 0 ||
    !state.lines.length
  )
    return;

  if (state.backendTrack) {
    state.timingsReady = true;
    normalizeLineEnds(els.audio.duration);
    renderTranscript();
    return;
  }

  let externalTimings = null;
  try {
    const response = await fetch(encodeURI(SOURCE.timings), {
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
  const rows = Array.isArray(data) ? data : data.lines;
  if (!Array.isArray(rows)) {
    buildAutoTimings(els.audio.duration);
    return;
  }

  rows.forEach((row, index) => {
    const line =
      typeof row.id === "string"
        ? state.lines.find((item) => item.id === row.id)
        : state.lines[index];

    if (!line) return;
    line.start = Number(row.start) || 0;
    line.end = Number(row.end) || line.start + 1;
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
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = titleCase(section.title);
    button.dataset.sectionId = section.id;
    button.addEventListener("click", () => {
      const firstLine = state.lines.find(
        (line) => line.sectionId === section.id,
      );
      if (!firstLine) return;
      seekToLine(firstLine);
      document
        .getElementById(firstLine.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    els.sectionNav.appendChild(button);
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

    const button = document.createElement("button");
    button.type = "button";
    button.id = line.id;
    button.className = `line ${line.type}`;
    button.dataset.index = String(state.lines.indexOf(line));
    button.addEventListener("click", () => seekToLine(line));

    const time = document.createElement("span");
    time.className = "line-time";
    time.textContent = state.timingsReady ? formatTime(line.start) : "--:--";

    const text = document.createElement("span");
    text.className = "line-text";

    if (line.speaker) {
      const speaker = document.createElement("span");
      speaker.className = "speaker";
      speaker.textContent = line.speaker;
      text.appendChild(speaker);
    }

    text.append(document.createTextNode(line.text));
    button.append(time, text);
    fragment.appendChild(button);
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

function updateFromTime(timeOverride = null) {
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

  document.querySelectorAll(".section-nav button").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.sectionId === activeLine.sectionId,
    );
  });

  if (els.autoScroll.checked && activeEl) {
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

function seekToLine(line) {
  const target = clamp(line.start, 0, els.audio.duration || line.start);
  els.audio.currentTime = target;
  updateProgress();
  updateFromTime();
  if (els.audio.paused) {
    els.audio.play();
  }
}

function seekBy(seconds) {
  els.audio.currentTime = clamp(
    els.audio.currentTime + seconds,
    0,
    els.audio.duration || 0,
  );
  updateProgress();
}

function describeBackendStatus(data) {
  const source = data.cached ? "已载入后端缓存" : "后端自动打点完成";
  const mode =
    data.mode === "faster-whisper" ? `Whisper ${data.model}` : "估算备用";
  return `${data.lines.length} 行原文 · ${source} · ${mode}`;
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
