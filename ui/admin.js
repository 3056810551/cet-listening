const EXAM_LABELS = {
  cet6: "CET-6",
  cet4: "CET-4",
};

const STATUS_LABELS = {
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
};

const state = {
  status: null,
  jobs: new Map(),
  selectedJobId: null,
  pollTimer: 0,
};

const els = {
  rootPath: document.querySelector("#rootPath"),
  refreshStatus: document.querySelector("#refreshStatus"),
  refreshJobs: document.querySelector("#refreshJobs"),
  toolBadges: document.querySelector("#toolBadges"),
  metricGrid: document.querySelector("#metricGrid"),
  statusExamFilter: document.querySelector("#statusExamFilter"),
  trackSearch: document.querySelector("#trackSearch"),
  trackRows: document.querySelector("#trackRows"),
  notice: document.querySelector("#notice"),
  scanForm: document.querySelector("#scanForm"),
  scanExam: document.querySelector("#scanExam"),
  scanGenerate: document.querySelector("#scanGenerate"),
  scanForce: document.querySelector("#scanForce"),
  singleForm: document.querySelector("#singleForm"),
  singleTrack: document.querySelector("#singleTrack"),
  singleForce: document.querySelector("#singleForce"),
  singleRefreshCatalog: document.querySelector("#singleRefreshCatalog"),
  whisperModel: document.querySelector("#whisperModel"),
  whisperDevice: document.querySelector("#whisperDevice"),
  whisperComputeType: document.querySelector("#whisperComputeType"),
  uploadForm: document.querySelector("#uploadForm"),
  uploadExam: document.querySelector("#uploadExam"),
  uploadTrackId: document.querySelector("#uploadTrackId"),
  uploadForce: document.querySelector("#uploadForce"),
  audioFile: document.querySelector("#audioFile"),
  markdownFile: document.querySelector("#markdownFile"),
  uploadAudio: document.querySelector("#uploadAudio"),
  uploadMarkdown: document.querySelector("#uploadMarkdown"),
  markdownForm: document.querySelector("#markdownForm"),
  markdownExam: document.querySelector("#markdownExam"),
  markdownTrackId: document.querySelector("#markdownTrackId"),
  markdownContent: document.querySelector("#markdownContent"),
  markdownForce: document.querySelector("#markdownForce"),
  normalizeForm: document.querySelector("#normalizeForm"),
  normalizeInput: document.querySelector("#normalizeInput"),
  combinedInputs: document.querySelector("#combinedInputs"),
  normalizeExam: document.querySelector("#normalizeExam"),
  normalizeYear: document.querySelector("#normalizeYear"),
  normalizeMonth: document.querySelector("#normalizeMonth"),
  normalizeSet: document.querySelector("#normalizeSet"),
  normalizeForce: document.querySelector("#normalizeForce"),
  jobList: document.querySelector("#jobList"),
  jobLog: document.querySelector("#jobLog"),
};

init();

function init() {
  bindEvents();
  refreshStatus();
}

function bindEvents() {
  els.refreshStatus.addEventListener("click", () => refreshStatus());
  els.refreshJobs.addEventListener("click", () => refreshStatus());
  els.statusExamFilter.addEventListener("change", renderTrackRows);
  els.trackSearch.addEventListener("input", renderTrackRows);
  els.scanForm.addEventListener("submit", handleScanSubmit);
  els.singleForm.querySelectorAll("[data-single-task]").forEach((button) => {
    button.addEventListener("click", () => handleSingleTask(button.dataset.singleTask));
  });
  els.uploadAudio.addEventListener("click", () => handleUpload("audio"));
  els.uploadMarkdown.addEventListener("click", () => handleUpload("markdown"));
  els.markdownForm.addEventListener("submit", handleMarkdownSave);
  els.normalizeForm.addEventListener("submit", handleNormalizeSubmit);
}

async function refreshStatus() {
  setNotice("正在刷新...");
  try {
    const data = await fetchJson("/api/admin/status", { cache: "no-store" });
    state.status = data;
    mergeJobs(data.jobs || []);
    renderStatus();
    setNotice(`已刷新 ${formatClock(new Date())}`);
  } catch (error) {
    setNotice(error.message, "error");
  }
}

function renderStatus() {
  if (!state.status) return;
  els.rootPath.textContent = state.status.root;
  renderToolBadges();
  renderMetrics();
  renderCombinedInputs();
  renderTrackSelect();
  renderTrackRows();
  renderJobs();
}

function renderToolBadges() {
  const { tools } = state.status;
  els.toolBadges.replaceChildren(
    badge(`Python ${tools.python}`, "ok"),
    badge(tools.ffprobe ? "ffprobe 已就绪" : "ffprobe 缺失", tools.ffprobe ? "ok" : "warn"),
    badge(
      tools.fasterWhisper ? "Whisper 已就绪" : "Whisper 未安装",
      tools.fasterWhisper ? "ok" : "warn",
    ),
  );
}

function renderMetrics() {
  const fragment = document.createDocumentFragment();
  ["cet6", "cet4"].forEach((exam) => {
    const counts = state.status.counts?.[exam] || {};
    const item = document.createElement("div");
    item.className = "metric";
    item.innerHTML = `
      <span>${EXAM_LABELS[exam]}</span>
      <strong>${counts.available || 0}/${counts.total || 0}</strong>
      <span>缺音频 ${counts.missingAudio || 0} · 缺原文 ${counts.missingTranscript || 0} · 缺时间轴 ${counts.missingTimings || 0}</span>
    `;
    fragment.appendChild(item);
  });
  els.metricGrid.replaceChildren(fragment);
}

function renderCombinedInputs() {
  const fragment = document.createDocumentFragment();
  (state.status.combinedInputs || []).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.path;
    option.label = item.name;
    fragment.appendChild(option);
  });
  els.combinedInputs.replaceChildren(fragment);
}

function renderTrackSelect() {
  const currentValue = els.singleTrack.value;
  const fragment = document.createDocumentFragment();
  getSortedTracks().forEach((track) => {
    const option = document.createElement("option");
    option.value = trackValue(track);
    option.textContent = `${EXAM_LABELS[track.exam]} · ${track.title}`;
    fragment.appendChild(option);
  });

  if (!fragment.childNodes.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无套题";
    fragment.appendChild(option);
  }

  els.singleTrack.replaceChildren(fragment);
  if ([...els.singleTrack.options].some((option) => option.value === currentValue)) {
    els.singleTrack.value = currentValue;
  }
}

function renderTrackRows() {
  if (!state.status) return;

  const tracks = getFilteredTracks();
  const fragment = document.createDocumentFragment();

  if (!tracks.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty-row";
    cell.textContent = "没有匹配的套题";
    row.appendChild(cell);
    fragment.appendChild(row);
  }

  tracks.forEach((track) => {
    const row = document.createElement("tr");
    row.appendChild(titleCell(track));
    row.appendChild(fileCell(track.files.audio));
    row.appendChild(fileCell(track.files.markdown));
    row.appendChild(fileCell(track.files.transcript));
    row.appendChild(fileCell(track.files.timings));

    const action = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-action";
    button.textContent = "选中";
    button.addEventListener("click", () => fillTrackFields(track));
    action.appendChild(button);
    row.appendChild(action);
    fragment.appendChild(row);
  });

  els.trackRows.replaceChildren(fragment);
}

function titleCell(track) {
  const cell = document.createElement("td");
  const title = document.createElement("div");
  title.className = "track-title";
  title.title = `${EXAM_LABELS[track.exam]} · ${track.id}`;
  title.textContent = track.title;
  cell.appendChild(title);
  return cell;
}

function fileCell(ok) {
  const cell = document.createElement("td");
  const span = document.createElement("span");
  span.className = ok ? "file-state ok" : "file-state";
  span.textContent = ok ? "有" : "缺";
  cell.appendChild(span);
  return cell;
}

function fillTrackFields(track) {
  els.uploadExam.value = track.exam;
  els.uploadTrackId.value = track.id;
  els.markdownExam.value = track.exam;
  els.markdownTrackId.value = track.id;
  els.singleTrack.value = trackValue(track);

  const [year, month] = parseTrackId(track.id);
  if (year) els.normalizeYear.value = year;
  if (month) els.normalizeMonth.value = month;
  setNotice(`已选中 ${track.title}`);
}

function getFilteredTracks() {
  const exam = els.statusExamFilter.value;
  const query = els.trackSearch.value.trim().toLowerCase();
  return getSortedTracks().filter((track) => {
    if (exam !== "all" && track.exam !== exam) return false;
    if (!query) return true;
    return `${track.title} ${track.id} ${track.exam}`.toLowerCase().includes(query);
  });
}

function getSortedTracks() {
  return [...(state.status?.tracks || [])].sort((a, b) => {
    if (a.exam !== b.exam) return a.exam.localeCompare(b.exam);
    return compareTrackIds(b.id, a.id);
  });
}

function handleScanSubmit(event) {
  event.preventDefault();
  startJob({
    task: "scan",
    exam: els.scanExam.value,
    generate: els.scanGenerate.checked,
    force: els.scanForce.checked,
    env: whisperEnv(),
  });
}

function handleSingleTask(task) {
  const selected = selectedTrackParts();
  if (!selected) {
    setNotice("请先选择套题。", "error");
    return;
  }

  startJob({
    task,
    exam: selected.exam,
    trackId: selected.id,
    force: els.singleForce.checked,
    refreshCatalog: els.singleRefreshCatalog.checked,
    env: whisperEnv(),
  });
}

async function handleUpload(kind) {
  if (!els.uploadForm.reportValidity()) return;
  const file = kind === "audio" ? els.audioFile.files[0] : els.markdownFile.files[0];
  if (!file) {
    setNotice(kind === "audio" ? "请选择音频文件。" : "请选择原文文件。", "error");
    return;
  }

  const params = new URLSearchParams({
    kind,
    exam: els.uploadExam.value,
    id: els.uploadTrackId.value.trim(),
    force: String(els.uploadForce.checked),
  });

  setNotice("正在上传...");
  try {
    const result = await fetchJson(`/api/admin/upload?${params}`, {
      method: "POST",
      headers: {
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    setNotice(`已保存 ${result.path}`);
    await refreshStatus();
  } catch (error) {
    setNotice(error.message, "error");
  }
}

async function handleMarkdownSave(event) {
  event.preventDefault();
  if (!els.markdownForm.reportValidity()) return;

  setNotice("正在保存原文...");
  try {
    const result = await fetchJson("/api/admin/save-markdown", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        exam: els.markdownExam.value,
        id: els.markdownTrackId.value.trim(),
        content: els.markdownContent.value,
        force: els.markdownForce.checked,
      }),
    });
    setNotice(`已保存 ${result.path}`);
    await refreshStatus();
  } catch (error) {
    setNotice(error.message, "error");
  }
}

function handleNormalizeSubmit(event) {
  event.preventDefault();
  if (!els.normalizeForm.reportValidity()) return;

  startJob({
    task: "normalize",
    input: els.normalizeInput.value.trim(),
    exam: els.normalizeExam.value,
    year: els.normalizeYear.value,
    month: els.normalizeMonth.value,
    set: els.normalizeSet.value,
    force: els.normalizeForce.checked,
  });
}

async function startJob(payload) {
  setNotice("任务已提交...");
  try {
    const job = await fetchJson("/api/admin/run", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    mergeJobs([job]);
    state.selectedJobId = job.id;
    renderJobs();
    pollSelectedJob();
    setNotice(`已启动：${job.label}`);
  } catch (error) {
    setNotice(error.message, "error");
  }
}

async function pollSelectedJob() {
  window.clearTimeout(state.pollTimer);
  if (!state.selectedJobId) return;

  try {
    const job = await fetchJson(`/api/admin/jobs/${state.selectedJobId}`, {
      cache: "no-store",
    });
    mergeJobs([job]);
    renderJobs();
    renderJobLog();

    if (job.status === "queued" || job.status === "running") {
      state.pollTimer = window.setTimeout(pollSelectedJob, 1200);
    } else {
      await refreshStatus();
    }
  } catch (error) {
    setNotice(error.message, "error");
  }
}

function mergeJobs(jobs) {
  jobs.forEach((job) => {
    const existing = state.jobs.get(job.id) || {};
    state.jobs.set(job.id, {
      ...existing,
      ...job,
      log: job.log || existing.log || [],
    });
  });

  if (!state.selectedJobId && state.jobs.size) {
    state.selectedJobId = sortedJobs()[0].id;
  }
}

function renderJobs() {
  const jobs = sortedJobs();
  const fragment = document.createDocumentFragment();

  if (!jobs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-row";
    empty.textContent = "暂无任务";
    fragment.appendChild(empty);
  }

  jobs.forEach((job) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "job-item";
    button.classList.toggle("active", job.id === state.selectedJobId);
    button.addEventListener("click", () => selectJob(job.id));

    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = job.label || "任务";
    const meta = document.createElement("span");
    meta.textContent = job.elapsedSeconds
      ? `${formatTimestamp(job.startedAt)} · ${job.elapsedSeconds}s`
      : formatTimestamp(job.startedAt);
    body.append(title, meta);

    const status = document.createElement("span");
    status.className = `job-status ${job.status || ""}`;
    status.textContent = STATUS_LABELS[job.status] || job.status || "未知";

    button.append(body, status);
    fragment.appendChild(button);
  });

  els.jobList.replaceChildren(fragment);
  renderJobLog();
}

async function selectJob(jobId) {
  state.selectedJobId = jobId;
  renderJobs();
  try {
    const job = await fetchJson(`/api/admin/jobs/${jobId}`, { cache: "no-store" });
    mergeJobs([job]);
    renderJobs();
    if (job.status === "running" || job.status === "queued") {
      pollSelectedJob();
    }
  } catch (error) {
    setNotice(error.message, "error");
  }
}

function renderJobLog() {
  const job = state.jobs.get(state.selectedJobId);
  if (!job) {
    els.jobLog.textContent = "暂无任务";
    return;
  }

  const log = job.log?.length ? job.log.join("\n") : job.commands?.join("\n") || "等待日志...";
  els.jobLog.textContent = log;
  els.jobLog.scrollTop = els.jobLog.scrollHeight;
}

function sortedJobs() {
  return [...state.jobs.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

function whisperEnv() {
  return {
    WHISPER_MODEL: els.whisperModel.value.trim(),
    WHISPER_DEVICE: els.whisperDevice.value,
    WHISPER_COMPUTE_TYPE: els.whisperComputeType.value,
  };
}

function selectedTrackParts() {
  const value = els.singleTrack.value;
  if (!value.includes(":")) return null;
  const [exam, id] = value.split(":");
  return { exam, id };
}

function trackValue(track) {
  return `${track.exam}:${track.id}`;
}

function badge(text, type) {
  const span = document.createElement("span");
  span.className = `badge ${type || ""}`;
  span.textContent = text;
  return span;
}

function setNotice(message, type = "") {
  els.notice.textContent = message || "";
  els.notice.classList.toggle("error", type === "error");
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
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function formatTimestamp(value) {
  if (!value) return "";
  return formatClock(new Date(value * 1000));
}

function formatClock(date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
