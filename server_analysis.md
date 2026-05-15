# 服务与时间轴生成说明

## 当前结构

- `server.py` 只负责本地静态文件服务和音频媒体流。
- `timings.py` 负责 Markdown 文本解析、标准 `.transcript.json` 生成、Whisper 单词时间戳识别、文本与音频对齐，以及 `.timings.json` 写入。
- `scan.py` 负责扫描 `transcripts/` 和 `audio/`，生成 `tracks.json`；加上 `--gen` 时会调用 `timings.py` 补齐缺失的时间轴文件。
- 前端从 `tracks.json` 读取标准 transcript JSON、音频和 timings 路径，不再请求 `/api/track`。

## 本地生成命令

批量扫描并生成缺失的 timings：

```powershell
python scan.py --gen
```

只扫描并生成标准 transcript JSON 与 `tracks.json`：

```powershell
python scan.py
```

强制重新生成已有 timings：

```powershell
python scan.py --gen --force
```

只生成单个文件：

```powershell
python timings.py transcripts/2025-12-2.md "audio/2025-12-2.mp3"
```

强制重跑单个文件：

```powershell
python timings.py transcripts/2025-12-2.md "audio/2025-12-2.mp3" --force
```

只生成单个标准 transcript JSON：

```powershell
python timings.py transcripts/2025-12-2.md --transcript-only
```

## server.py

`server.py` 基于 `SimpleHTTPRequestHandler`，保留两类职责：

1. 托管 `index.html`、`ui/`、`tracks.json`、`transcripts/` 等静态文件。
2. 对 `.mp3`、`.m4a`、`.wav`、`.ogg`、`.flac`、`.aac` 提供 HTTP Range 支持，保证浏览器音频播放器可以拖动进度和断点读取。

它不再加载 Whisper，也不再生成或修改 `.timings.json`。

## timings.py

核心流程：

1. `build_transcript()` 将 Markdown 拆成 sections 和 lines，并写入同目录 `.transcript.json`。
2. `ffprobe_duration()` 读取音频总时长。
3. `transcribe_words()` 使用 `faster-whisper` 生成单词级时间戳。
4. `apply_aligned_timings()` 用 `SequenceMatcher` 对齐文本单词和音频单词。
5. 若 Whisper 不可用或匹配失败，`apply_estimated_timings()` 会按文本长度估算时间轴。
6. 结果写到 Markdown 同目录的 `.timings.json`。

Whisper 配置仍然通过环境变量控制：

- `WHISPER_MODEL`，默认 `small.en`
- `WHISPER_DEVICE`，默认 `cpu`
- `WHISPER_COMPUTE_TYPE`，默认 `int8`
