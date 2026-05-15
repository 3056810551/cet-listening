# CET-4/6 听力训练网站

一个面向大学英语四、六级听力精听训练的本地网页应用。项目把历年听力音频、原文和句级时间轴组织成可浏览的题库，支持逐句播放、原文高亮、段落跳转、倍速、快捷键和可拖动播放器，适合用来做精听、跟读、复盘和材料整理。

当前仓库已经按同一数据结构整理了 37 套六级听力材料；四级材料也可以用相同的命名和生成流程接入。

![界面预览](docs/img.png)

## 功能特性

- 题库列表：左侧按年份、月份、套题展示听力材料，支持顺序/逆序切换。
- 音频播放：支持播放/暂停、进度条拖动、前进/后退 5 秒、1x/1.25x/1.5x 倍速。
- 句级时间轴：原文按句拆分并显示开始时间，播放时自动高亮当前句。
- 逐句精听：每一句右侧都有播放按钮，点击即可跳到该句并播放。
- 自动滚动：播放时自动把当前句滚动到视野中心，可随时关闭。
- 原文开关：可隐藏/显示听力原文，用于盲听或复盘。
- 段落导航：右侧按 Conversation、Passage、Recording 分段跳转。
- 可调整布局：左右侧栏可隐藏、恢复、拖动调整宽度。
- 悬浮播放器：底部播放器可拖动，也可固定；位置和固定状态会保存在浏览器本地。
- 分享定位：URL 支持 `?track=2025-12-2` 这样的参数，方便直接打开指定套题。
- 音频 Range 支持：本地 Python 服务支持浏览器分段请求，拖动进度条和大音频播放更稳定。

## 技术栈

- 前端：原生 HTML、CSS、JavaScript，无构建步骤。
- 本地服务：Python `http.server` + 自定义媒体 Range 处理。
- 数据：`tracks.json` 题库索引、Markdown 原文、标准化 transcript JSON、timings JSON。
- 时间轴生成：`ffprobe` 获取音频时长，`faster-whisper` 可选用于自动语音识别与文本对齐。

## 快速开始

### 环境要求

- Python 3.10 或更新版本。
- 现代浏览器：Chrome、Edge、Firefox 等。
- 如果只播放已有材料，不需要安装额外 Python 依赖。
- 如果要重新生成时间轴，需要安装 FFmpeg，并确保命令行能访问 `ffprobe`。
- 如果要使用 Whisper 自动对齐，建议安装 `faster-whisper`。

### Windows 启动

直接双击：

```bat
start.bat
```

或在项目根目录运行：

```powershell
python server.py
```

### macOS / Linux / Git Bash 启动

```bash
python3 server.py
```

如果你的环境把 Python 3 绑定到了 `python`，也可以运行：

```bash
python server.py
```

启动后打开控制台提示的地址，默认是：

```text
http://127.0.0.1:5173/
```

如果 `5173` 已被占用，服务会自动尝试后续端口。

### 指定端口

PowerShell：

```powershell
$env:PORT=5180
python server.py
```

Bash：

```bash
PORT=5180 python3 server.py
```

## 使用指南

1. 在左侧选择一套听力材料。
2. 点击底部 `Play` 开始播放。
3. 使用进度条、前进/后退按钮或键盘快捷键定位音频。
4. 点击原文中的单句播放按钮，进行逐句精听。
5. 右侧段落导航可快速跳转到 Conversation、Passage 或 Recording。
6. 需要盲听时关闭 `显示原文`；需要复盘时再打开。
7. 不想播放时自动滚动，可以关闭 `自动滚动`。

### 键盘快捷键

- `Space`：播放/暂停。
- `ArrowLeft`：后退 5 秒。
- `ArrowRight`：前进 5 秒。

## 项目结构

```text
.
├── audio/                         # 本地音频文件，默认被 .gitignore 忽略
├── data_tools/
│   ├── scan.py                    # 扫描原文和音频，生成 tracks.json
│   ├── timings.py                 # 生成 transcript JSON 和 timings JSON
│   ├── normalize_transcripts.py   # 拆分、清洗整合版原文
│   └── 0.md                       # 默认的待拆分原文输入文件
├── docs/
│   └── app-preview.png            # README 界面预览图
├── transcripts/
│   ├── 2025-12-2.md               # 原始 Markdown 原文
│   ├── 2025-12-2.transcript.json  # 标准化句级原文
│   └── 2025-12-2.timings.json     # 句级时间轴
├── ui/
│   ├── app.js                     # 播放器、题库、原文渲染和交互逻辑
│   └── styles.css                 # 页面样式和响应式布局
├── index.html                     # 应用入口
├── server.py                      # 本地静态服务和音频 Range 服务
├── start.bat                      # Windows 一键启动脚本
├── tracks.json                    # 题库索引
└── improvement_suggestions.md     # 后续优化建议
```

## 数据说明

### `tracks.json`

前端启动后会读取 `tracks.json`，每一项代表一套听力：

```json
{
  "id": "2025-12-2",
  "title": "2025 年 12 月 第 2 套",
  "markdown": "transcripts/2025-12-2.md",
  "transcript": "transcripts/2025-12-2.transcript.json",
  "audio": "audio/2025-12-2.mp3",
  "timings": "transcripts/2025-12-2.timings.json",
  "available": true
}
```

字段含义：

- `id`：套题唯一标识，推荐格式为 `YYYY-M-套数`。
- `title`：页面展示标题。
- `markdown`：原始 Markdown 原文路径。
- `transcript`：标准化后的句级原文 JSON。
- `audio`：音频路径。
- `timings`：句级时间轴 JSON。
- `available`：是否已经有标准化原文和时间轴。

### Markdown 原文格式

原文文件放在 `transcripts/`，建议命名为：

```text
YYYY-M-套数.md
```

示例：

```markdown
## CONVERSATION 1

W: I must say, I love our canteen!
M: Yeah, it really is, both for students and teachers.
Q1. What does the woman say about the food at the canteen?

## PASSAGE 1

Reading with a young child is important.
Q9. What does the speaker mainly talk about?
```

解析规则：

- `##` 标题会被识别为段落。
- `M:`、`W:` 会被识别为对话发言人。
- `Q1.`、`Q2.` 这类行会被识别为题目。
- 普通文本会被识别为旁白。
- 长句会按英文标点自动拆成更细的句子。

### Transcript JSON

`.transcript.json` 是从 Markdown 清洗、拆句后得到的标准结构，包含：

- `sections`：段落列表。
- `lines`：逐句原文、发言人、类型、词数、所属段落。

前端优先读取 transcript JSON；如果缺失，会退回读取 Markdown 并在浏览器里临时解析。

### Timings JSON

`.timings.json` 在 transcript 的基础上给每一句添加：

- `start`：该句开始时间，单位为秒。
- `end`：该句结束时间，单位为秒。
- `matchedWords`：Whisper 对齐时匹配到的词数，可能不存在。

如果 timings JSON 缺失，前端会根据音频总时长和句子长度估算时间轴，但精度会低于已生成的时间轴。

## 数据维护流程

### 添加一套新材料

1. 把音频放入 `audio/`，推荐命名：

```text
audio/2026-6-1.mp3
```

2. 把原文放入 `transcripts/`，推荐命名：

```text
transcripts/2026-6-1.md
```

3. 生成标准化 transcript JSON，并刷新题库索引：

PowerShell：

```powershell
python data_tools/scan.py
```

Bash：

```bash
python3 data_tools/scan.py
```

4. 生成时间轴：

PowerShell：

```powershell
python data_tools/scan.py --gen
```

Bash：

```bash
python3 data_tools/scan.py --gen
```

5. 重启服务或刷新页面。如果浏览器缓存导致样式或数据没有更新，请按 `Ctrl + F5` 强制刷新。

### 只处理单套材料

生成标准化 transcript JSON：

PowerShell：

```powershell
python data_tools/timings.py transcripts/2026-6-1.md --transcript-only
```

Bash：

```bash
python3 data_tools/timings.py transcripts/2026-6-1.md --transcript-only
```

生成单套时间轴：

PowerShell：

```powershell
python data_tools/timings.py transcripts/2026-6-1.md audio/2026-6-1.mp3
```

Bash：

```bash
python3 data_tools/timings.py transcripts/2026-6-1.md audio/2026-6-1.mp3
```

强制重新生成：

PowerShell：

```powershell
python data_tools/timings.py transcripts/2026-6-1.md audio/2026-6-1.mp3 --force
```

Bash：

```bash
python3 data_tools/timings.py transcripts/2026-6-1.md audio/2026-6-1.mp3 --force
```

### 从整合版原文拆分

如果有一个包含多套听力的总 Markdown，可以使用 `normalize_transcripts.py` 拆分：

PowerShell：

```powershell
python data_tools/normalize_transcripts.py data_tools/0.md --year 2026 --month 6 --force
```

Bash：

```bash
python3 data_tools/normalize_transcripts.py data_tools/0.md --year 2026 --month 6 --force
```

只提取指定套题：

PowerShell：

```powershell
python data_tools/normalize_transcripts.py data_tools/0.md --year 2026 --month 6 --set 1 --force
```

Bash：

```bash
python3 data_tools/normalize_transcripts.py data_tools/0.md --year 2026 --month 6 --set 1 --force
```

## 时间轴生成配置

`timings.py` 默认使用以下环境变量：

| 变量                   | 默认值     | 说明                             |
| ---------------------- | ---------- | -------------------------------- |
| `WHISPER_MODEL`        | `small.en` | faster-whisper 模型名称          |
| `WHISPER_DEVICE`       | `cpu`      | 运行设备，例如 `cpu` 或 `cuda`   |
| `WHISPER_COMPUTE_TYPE` | `int8`     | 计算类型，例如 `int8`、`float16` |

CPU 示例：

PowerShell：

```powershell
$env:WHISPER_MODEL="small.en"
$env:WHISPER_DEVICE="cpu"
$env:WHISPER_COMPUTE_TYPE="int8"
python data_tools/scan.py --gen
```

Bash：

```bash
WHISPER_MODEL="small.en" WHISPER_DEVICE="cpu" WHISPER_COMPUTE_TYPE="int8" python3 data_tools/scan.py --gen
```

NVIDIA GPU 示例：

PowerShell：

```powershell
$env:WHISPER_MODEL="small.en"
$env:WHISPER_DEVICE="cuda"
$env:WHISPER_COMPUTE_TYPE="float16"
python data_tools/scan.py --gen
```

Bash：

```bash
WHISPER_MODEL="small.en" WHISPER_DEVICE="cuda" WHISPER_COMPUTE_TYPE="float16" python3 data_tools/scan.py --gen
```

首次运行 Whisper 模型可能需要下载模型文件，耗时会比较长。没有安装 `faster-whisper` 时，脚本会在拿到音频时长后使用估算时间轴作为降级方案；没有 `ffprobe` 时则无法生成 timings JSON。

## 本地状态

部分界面状态保存在浏览器 `localStorage` 中：

- 播放器是否固定。
- 播放器拖动位置。
- 左右侧栏宽度。
- 左右侧栏是否隐藏。
- 题库列表顺序/逆序。

如果布局看起来异常，可以在浏览器开发者工具中清理该站点的本地存储，或换一个浏览器重新打开。

## 常见问题

### 页面打不开

确认 Python 服务已经启动，并使用控制台打印出来的地址访问，例如 `http://127.0.0.1:5173/`。不要直接双击打开 `index.html`，否则浏览器可能因为本地文件安全策略无法正常读取 JSON 和音频。

### 音频不能播放

检查 `tracks.json` 中的 `audio` 路径是否存在，文件名是否和实际音频一致。仓库的 `.gitignore` 默认忽略 `*.mp3`，所以新环境需要单独准备 `audio/` 目录下的音频文件。

### 拖动进度条不稳定

请通过 `python server.py` 启动项目。本项目的服务端专门处理了媒体 Range 请求，直接用某些简单静态服务或本地文件方式打开时，大音频跳转体验可能不稳定。

### 原文和音频不同步

优先检查对应的 `.timings.json` 是否存在且是最新生成的。修改 Markdown 原文或更换音频后，建议运行：

PowerShell：

```powershell
python data_tools/scan.py --gen --force
```

Bash：

```bash
python3 data_tools/scan.py --gen --force
```

### 控制台提示端口被占用

`server.py` 会从 `PORT` 指定端口开始向后尝试 50 个端口。查看控制台输出的最终地址即可。

## 开发说明

前端没有构建步骤，修改以下文件后刷新页面即可：

- `index.html`：页面结构。
- `ui/styles.css`：布局和视觉样式。
- `ui/app.js`：播放器、题库、原文和交互逻辑。

本地服务入口是 `server.py`。它继承 `SimpleHTTPRequestHandler`，并为音频文件补充了：

- `Range` 请求解析。
- `206 Partial Content` 响应。
- `Accept-Ranges: bytes`。
- 大文件分块传输。

## 后续可扩展方向

仓库中的 `improvement_suggestions.md` 已经整理了更完整的 Roadmap。优先级较高的方向包括：

- AB 段落循环和单句循环。
- 深色模式。
- 移动端锁屏控制和 Media Session API。
- 点击查词、生词本。
- 听写/填空模式。
- 波形图和更细粒度的时间轴编辑。
- PWA 离线缓存。
- SQLite 或后端 API，用于更大规模题库检索。

## 许可证

项目代码采用 [MIT License](LICENSE) 开源。

音频、原文和真题内容的版权归原权利方所有。本项目用于个人学习、听力训练和本地材料整理，请在合法范围内使用和分发相关资源。
