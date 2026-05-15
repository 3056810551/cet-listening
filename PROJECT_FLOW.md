# CET-6 Listening Player Project Flow

本文档梳理当前项目的整体运行流程、文件职责、前后端数据流和主要代码逻辑。项目本质上是一个本地六级听力播放器：用 Markdown 保存听力原文，用音频文件播放听力，用 JSON 时间轴把音频时间和原文行对应起来。

## 1. 项目文件

当前目录主要文件如下：

- `index.html`：页面结构。包含左侧听力列表、中间播放器与原文区、右侧当前听力信息和章节导航。
- `styles.css`：全部样式。负责三栏布局、浮动播放器、侧栏收起/恢复、原文高亮、移动端适配。
- `app.js`：前端主逻辑。负责加载数据、播放控制、原文渲染、时间轴同步、侧栏拖拽、播放器拖拽和本地状态持久化。
- `server.py`：本地 HTTP 服务和后端 API。负责静态文件服务、音频 Range 请求、读取 Markdown、生成/读取时间轴缓存。
- `start.bat`：Windows 启动脚本，进入项目目录后执行 `python server.py`。
- `2025-12-1.md`：听力原文。用二级标题 `## ...` 分章节，正文包含说话人行和题目行。
- `2025-12-1.timings.json`：本地生成的时间轴缓存。保存每一行原文的 `start` / `end` 时间。
- `metadata/`：建议新增的元信息目录，用来集中存放 Markdown 和音频的文件元信息、生成记录、模型配置等辅助数据。
- `2025年12月六级听力音频第1套.mp3`：听力音频文件。

## 2. 启动流程

推荐启动方式：

```bat
start.bat
```

`start.bat` 做两件事：

```bat
cd /d "%~dp0"
python server.py
```

也就是切到当前项目目录，然后启动 Python 本地服务。

`server.py` 默认从 `PORT` 环境变量读取端口；如果没有设置，就从 `5173` 开始尝试。如果 `5173` 被占用，会继续尝试后续端口，最多尝试 50 个。

启动成功后，控制台会输出类似：

```text
CET-6 listening player: http://127.0.0.1:5173/
Backend endpoint: /api/track
```

浏览器访问这个地址后，会加载 `index.html`、`styles.css`、`app.js`、音频和接口数据。

## 3. 页面结构

`index.html` 的根结构是 `.shell`，它是一个五列 grid：

```text
左侧 catalog | 左侧 resizer | 中间 player | 右侧 resizer | 右侧 details
```

主要区域：

- `.catalog`：左侧听力列表，由 `app.js` 根据 `TRACK_CATALOG` 动态渲染。
- `.left-resizer`：左侧栏宽度拖拽条。
- `.player`：中间主区域，包含浮动播放器 `.now-playing` 和原文工作区 `.workspace`。
- `.now-playing`：播放器控制区，现在是 `position: fixed` 的浮动面板。
- `.workspace`：原文容器，内部的 `#transcript` 由 JS 动态生成。
- `.right-resizer`：右侧栏宽度拖拽条。
- `.details`：右侧当前听力信息和章节导航。
- `.restore-sidebar`：侧栏被隐藏时出现的恢复按钮，保持固定在左右顶角。

## 4. 前端启动流程

`app.js` 加载后立即执行：

```js
init();
```

`init()` 的流程：

1. `restoreLayoutState()`：恢复左右侧栏宽度和收起状态。
2. `restorePlayerPinned()`：恢复浮动播放器是否固定。
3. `restorePlayerPosition()`：恢复浮动播放器最后一次拖动后的位置。
4. 设置当前音频标题和 `audio.src`。
5. `renderTrackList()`：渲染左侧听力列表。
6. `bindEvents()`：绑定所有交互事件。
7. `loadTrack()`：加载原文、章节和时间轴。
8. 成功后把数据写入 `state.sections` 和 `state.lines`。
9. `renderSections()`：渲染右侧章节导航。
10. `renderTranscript()`：渲染中间原文列表。
11. 更新右侧元信息 `trackMeta`。

如果加载失败，页面会在原文区显示错误提示。

## 5. 数据加载流程

前端当前配置集中在 `SOURCE` 和 `TRACK_CATALOG`：

- `SOURCE.markdown`：Markdown 原文文件名。
- `SOURCE.audio`：音频文件名。
- `SOURCE.timings`：时间轴 JSON 文件名。
- `SOURCE.title`：右侧显示的当前听力标题。
- `TRACK_CATALOG`：左侧听力列表，目前只有一个可用条目。

`loadTrack()` 会优先请求后端 API：

```text
/api/track?markdown=2025-12-1.md&audio=...
```

如果请求成功，使用后端返回的 `sections` 和 `lines`，并标记为 `backend: true`。

如果后端接口不可用，前端会退回到纯浏览器模式：

1. `fetchText(SOURCE.markdown)` 读取 Markdown。
2. `parseMarkdown(markdown)` 在浏览器里解析章节和原文行。
3. 后续在音频元数据加载后，再尝试读取 `SOURCE.timings`。
4. 如果 JSON 时间轴也不可用，就按文本长度自动估算每行时间。

## 6. 后端 API 流程

`server.py` 使用 Python 标准库的 `ThreadingHTTPServer` 和 `SimpleHTTPRequestHandler`，没有依赖 Flask。

核心请求：

```text
GET /api/track?markdown=...&audio=...
```

处理流程在 `Cet6Handler.handle_track()`：

1. 读取 query 参数里的 `markdown`、`audio`、`force`。
2. 用 `safe_child()` 确认路径在项目目录内，避免访问项目外文件。
3. 调用 `build_track(markdown_path, audio_path, force=force)`。
4. 返回 JSON。

`build_track()` 的流程：

1. 读取 Markdown，并用后端版 `parse_markdown()` 解析出 `sections` 和 `lines`。
2. 计算缓存文件路径，例如 `2025-12-1.timings.json`。
3. 读取或写入 `metadata/` 中的源文件元信息，包括 Markdown 和音频的文件名、大小和修改时间。
4. 读取 Whisper 配置：
   - `WHISPER_MODEL`，默认 `base.en`
   - `WHISPER_DEVICE`，默认 `cpu`
   - `WHISPER_COMPUTE_TYPE`，默认 `int8`
5. 如果缓存存在且没有强制刷新，就用 `read_fresh_cache()` 判断缓存是否仍然有效。
6. 缓存有效时，用 `with_current_transcript()` 把缓存时间轴合并到当前 Markdown 解析结果里并返回。
7. 缓存无效或不存在时，调用 `generate_track()` 重新生成。
8. 在本地生成时间轴后写回 `.timings.json`，相关 Markdown 和音频元信息写入 `metadata/`。

缓存有效条件包括：

- `version` 等于当前 `CACHE_VERSION`。
- `metadata/` 中记录的 Markdown 和音频元信息与当前文件一致。
- 如果模式是 `faster-whisper`，模型名、设备、计算类型也要一致。
- 缓存里必须有 `lines` 数组。

## 7. 时间轴生成流程

后端 `generate_track()` 负责生成时间轴。

主要步骤：

1. 用 `ffprobe_duration(audio_path)` 调用 `ffprobe` 获取音频总时长。
2. 默认尝试使用 `faster-whisper`：
   - 加载 `WhisperModel`
   - `model.transcribe(..., word_timestamps=True)`
   - 收集每个词的 `token`、`start`、`end`
3. 用 `apply_aligned_timings(lines, words, duration)` 把音频词时间对齐到 Markdown 原文行。
4. 如果 Whisper 没有返回词时间，或者执行失败，则进入 `estimated-fallback`：
   - 按每行词数、题目权重等估算时间分布。
5. 生成 payload，包括：
   - `version`
   - `audio`
   - `markdown`
   - `duration`
   - `source`
   - `generatedAt`
   - `elapsedSeconds`
   - `mode`
   - `model`
   - `device`
   - `computeType`
   - `warning`
   - `transcription`
   - `sections`
   - `lines`

### Whisper 对齐逻辑

`apply_aligned_timings()` 的核心思想：

1. 把 Markdown 每一行拆成 token，形成参考 token 序列。
2. 把 Whisper 识别出来的词也标准化为 token 序列。
3. 用 `SequenceMatcher` 找两个 token 序列中的相同片段。
4. 把匹配到的音频词时间归到对应行。
5. 如果一行匹配词数量达到阈值，就认为该行有可靠起始时间。
6. 对没有匹配到的行，用 `fill_missing_starts()` 在已知时间之间按权重补齐。
7. 最后用 `apply_starts()` 写入每行的 `start` 和 `end`。

如果完全无法对齐，就使用 `estimated_starts()`。

## 8. Markdown 解析规则

前端和后端各有一份 Markdown 解析逻辑，规则基本一致。

章节：

```md
## CONVERSATION 1
```

会生成：

```json
{
  "id": "conversation-1",
  "title": "CONVERSATION 1",
  "firstLineId": "line-0"
}
```

正文行规则：

- `W: ...` / `M: ...`：识别为对话行，speaker 是 `W:` 或 `M:`，type 是 `dialogue`。
- `Q1. ...`：识别为题目行，speaker 是 `Q1.`，type 是 `question`。
- 其他普通文本：识别为叙述行，type 是 `narration`。

一句较长的对话会通过 `splitSentences()` / `split_sentences()` 按英文句号、问号、感叹号拆成多行。代码里也保护了一些英文缩写，例如 `Mr.`、`Dr.`、`etc.`，避免误拆。

每个原文行最终大致长这样：

```json
{
  "id": "line-0",
  "sectionId": "conversation-1",
  "sectionTitle": "CONVERSATION 1",
  "speaker": "W:",
  "text": "...",
  "type": "dialogue",
  "words": 16,
  "start": 37.18,
  "end": 44.6
}
```

## 9. 前端时间轴应用

音频触发 `loadedmetadata` 后，前端调用 `applyTimings()`。

如果当前数据来自后端 API：

1. 设置 `state.timingsReady = true`。
2. 调用 `normalizeLineEnds(audio.duration)` 确保每一行都有 `end`。
3. 重新渲染原文，显示每行起始时间。

如果当前是浏览器 fallback 模式：

1. 请求 `SOURCE.timings`。
2. 如果 JSON 存在，调用 `mergeExternalTimings()` 合并时间轴。
3. 如果 JSON 不存在，调用 `buildAutoTimings(audio.duration)` 自动估算。
4. 设置 `state.timingsReady = true`。
5. 重新渲染原文。

## 10. 播放和同步流程

播放控制相关事件在 `bindEvents()` 中绑定：

- 播放按钮：切换 `audio.play()` / `audio.pause()`。
- 后退按钮：`seekBy(-5)`。
- 前进按钮：`seekBy(5)`。
- 进度条拖动：把 range 值换算成音频时间。
- 倍速按钮：设置 `audio.playbackRate`，并切换 active 样式。
- 空格键：播放/暂停。
- 左右方向键：后退/前进 5 秒。

音频播放时：

1. `timeupdate` 触发。
2. `updateProgress()` 更新进度条和当前时间。
3. `updateFromTime()` 根据当前时间找到 active 原文行。
4. 当前行加 `.active`。
5. 已经过的行加 `.passed`。
6. 右侧章节导航同步 active 状态。
7. 如果“自动滚动”开启，当前行滚动到视口中央。

查找当前行使用 `findActiveLineIndex(time)`，它用二分查找在 `state.lines` 里找到当前时间对应的行。

点击原文行或章节导航时，会调用 `seekToLine(line)`：

1. 把音频跳到该行 `start`。
2. 更新进度条。
3. 更新 active 行。
4. 如果音频暂停，则自动播放。

## 11. 浮动播放器逻辑

`.now-playing` 是浮动播放器，CSS 里是：

```css
position: fixed;
left: 50%;
bottom: 88px;
```

默认位置是页面下方居中。用户可以拖动它到其他位置。

相关本地存储：

- `cet6-player-pinned`：是否固定播放器。
- `cet6-player-position`：最后一次拖动结束时的播放器位置。

初始化时：

1. `restorePlayerPinned()` 恢复固定状态。
2. `restorePlayerPosition()` 恢复最后位置。

拖动逻辑在 `bindFloatingPlayer()`：

1. 如果播放器是固定状态，不能拖动。
2. 如果点击的是按钮、input、label，也不触发拖动，避免影响播放控制。
3. 在播放器空白区域按下鼠标后开始拖动。
4. 移动时调用 `setPlayerPosition(left, top, rect)`。
5. 松手时调用 `savePlayerPosition()`，把最终位置写入 `localStorage`。

`setPlayerPosition()` 会把位置限制在当前窗口内，避免刷新后浮动播放器出现在屏幕外。

固定按钮：

- 初始浅色表示可拖动。
- 点击后进入固定状态，按钮变深色，播放器不能拖动。
- 再点一次取消固定，恢复可拖动。

## 12. 显示原文开关

“显示原文”开关只控制 `.workspace` 是否隐藏：

```js
els.workspace.hidden = !els.transcriptVisible.checked;
```

它不改播放状态、不改时间轴、不改自动滚动逻辑，也不做本地持久化。

## 13. 侧栏布局和持久化

左右侧栏支持：

- 拖动宽度。
- 点击隐藏。
- 点击恢复按钮显示。

相关本地存储：

- `cet6-left-sidebar-width`
- `cet6-right-sidebar-width`
- `cet6-left-sidebar-collapsed`
- `cet6-right-sidebar-collapsed`

`restoreLayoutState()` 在页面启动时恢复这些状态。

宽度限制：

- 左侧栏：180px 到 420px。
- 右侧栏：220px 到 460px。

侧栏隐藏时：

- `.shell.left-collapsed` 会把 `--left-sidebar-width` 设为 `0px`。
- `.shell.right-collapsed` 会把 `--right-sidebar-width` 设为 `0px`。
- 对应 `.restore-sidebar` 显示在页面顶部左右角。

## 14. 样式结构

`styles.css` 的主要职责：

- `:root`：定义颜色、阴影、侧栏宽度、resizer 宽度等变量。
- `.shell`：桌面端五列 grid 布局。
- `.catalog` / `.details`：左右侧栏。
- `.resizer`：侧栏拖拽条。
- `.restore-sidebar`：侧栏恢复按钮。
- `.now-playing`：浮动播放器。
- `.pin-player` / `.pin-icon`：播放器固定按钮。
- `.progress-row`：当前时间、进度条、总时长。
- `.controls`：播放控制行，现在水平居中。
- `.seek-btn` / `.seek-icon`：前进/后退 5 秒图标按钮。
- `.switch-control`：显示原文开关。
- `.workspace`：原文滚动区，底部留出 padding 防止被浮动播放器遮住。
- `.transcript`：原文列表容器。
- `.line`：单行原文按钮。
- `.line.active`：当前播放行。
- `.line.passed`：已经播放过的行。
- `@media (max-width: 860px)`：移动端单列布局。
- `@media (max-width: 520px)`：更窄屏幕下播放控制改成 grid。

## 15. 音频服务和 Range 请求

`server.py` 对音频文件做了特殊处理。

浏览器播放音频时通常会发 Range 请求，例如只请求某一段字节。`Cet6Handler.handle_media()` 支持：

- `GET`
- `HEAD`
- `Range: bytes=...`
- `206 Partial Content`
- `416 Range Not Satisfiable`

这样音频可以正常拖动进度条，也不用一次性完整读入整个文件。

## 16. 缓存文件结构

`2025-12-1.timings.json` 是本地生成的时间轴缓存。重要字段：

- `version`：缓存结构版本。
- `audio`：音频文件名。
- `markdown`：Markdown 文件名。
- `duration`：音频时长。
- `source`：历史兼容字段；新的 Markdown 和音频文件元信息建议放到 `metadata/` 中，用于判断缓存是否过期。
- `generatedAt`：生成时间戳。
- `elapsedSeconds`：生成耗时。
- `mode`：`faster-whisper` 或 `estimated-fallback`。
- `model`：Whisper 模型，例如 `base.en`。
- `device`：运行设备，例如 `cpu`。
- `computeType`：计算类型，例如 `int8`。
- `transcription`：Whisper 识别元信息。
- `sections`：章节列表。
- `lines`：每行原文和时间轴。

如果 Markdown 或音频文件修改了，`metadata/` 中记录的大小或修改时间会变化，后端会认为旧缓存失效并在本地重新生成 `.timings.json`。

## 17. 添加新听力材料的思路

目前 `TRACK_CATALOG` 只有一条数据。如果要扩展多套听力，大致需要：

1. 把新的 `.md` 和音频文件放到项目目录。
2. 准备或生成对应 `.timings.json`。
3. 在 `app.js` 的 `TRACK_CATALOG` 中加入新条目。
4. 让点击左侧列表时切换当前 `SOURCE` 或改造成动态 current track。

当前代码里 `SOURCE` 是常量，左侧列表只展示当前条目；所以多套切换还需要进一步改造。

## 18. 运行依赖

基础运行：

- Python 3
- 浏览器

本地生成精确时间轴需要：

- `ffprobe`，通常来自 FFmpeg。
- `faster-whisper` Python 包。
- 可选环境变量：
  - `WHISPER_MODEL`
  - `WHISPER_DEVICE`
  - `WHISPER_COMPUTE_TYPE`

如果 Whisper 不可用，后端会进入估算模式；如果后端不可用，前端也能尝试读取 Markdown 和 JSON 时间轴做 fallback。

## 19. 当前整体流程总结

一次完整页面加载可以概括为：

1. 启动 `server.py`。
2. 浏览器打开本地页面。
3. `index.html` 加载 `styles.css` 和 `app.js`。
4. `app.js` 恢复本地 UI 状态，包括侧栏、播放器固定状态、播放器位置。
5. 前端请求 `/api/track`。
6. 本地流程读取 `metadata/` 中的 Markdown 和音频元信息。
7. 后端优先复用新鲜 `.timings.json` 缓存。
8. 缓存不可用时，本地生成时间轴并写入 `.timings.json`；Markdown 和音频元信息写入新的 `metadata/` 文件夹。
9. 前端拿到 `sections` 和 `lines` 后渲染章节导航和原文。
10. 音频 metadata 加载完成后，前端确认时间轴可用并显示每行时间。
11. 播放时，前端持续根据当前时间高亮原文行、更新进度条、同步章节导航。
12. 用户可以拖动浮动播放器、固定播放器、隐藏原文、拖拽侧栏、跳转章节或点击任意原文行播放。
