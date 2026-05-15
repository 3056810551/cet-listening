# server.py 详细代码解读

`server.py` 是 CET-6 听力练习应用的核心后端脚本。它不仅负责提供静态网页服务，还集成了语音转文字（ASR）引擎，实现了听力原文与音频的高精度自动对齐。

---

## 1. 核心功能概述

该脚本主要实现以下四大功能：
1.  **静态文件服务**：托管前端的 `index.html`, `styles.css`, `app.js` 等。
2.  **媒体流支持**：实现 HTTP Range 请求，支持音频的断点续传和进度拖动。
3.  **文本解析**：将 Markdown 格式的听力原文解析为结构化的 JSON 数据（包含章节、发言人、句子等）。
4.  **自动时间轴对齐**：调用 `faster-whisper` 模型提取音频时间戳，并与文本进行模糊匹配，生成每一句听力原文的起止时间。

---

## 2. 核心类与逻辑分析

### 2.1 Cet6Handler (请求处理器)
继承自 `SimpleHTTPRequestHandler`，重写了核心处理逻辑：
-   **`do_GET`**: 
    -   拦截 `/api/track`：处理对齐逻辑的核心接口。
    -   拦截媒体文件（.mp3, .wav 等）：调用 `handle_media` 进行流式传输。
    -   默认：处理常规文件请求。
-   **`handle_media`**: 
    -   支持 **Byte Range Requests**。这对于音频播放器极其重要，因为它允许浏览器请求音频的任意片段，从而实现拖动进度条的功能。
    -   处理 `206 Partial Content` 响应。

### 2.2 文本解析逻辑 (Markdown Parsing)
-   **`parse_markdown`**: 识别以 `##` 开头的二级标题作为章节（Sections）。
-   **`split_transcript_line`**: 
    -   识别发言人：如 `A:`, `B:`。
    -   识别题目：如 `Q1.`。
    -   自动断句：利用正则将长段落切分为适合播放的短句。
-   **`clean_mojibake`**: 修复由于编码问题产生的常见乱码字符。

### 2.3 语音识别与对齐 (Whisper & Alignment)
这是该项目的技术核心：
-   **`transcribe_words`**: 使用 `faster-whisper` 模型。它会返回音频中每个单词的精确时间戳。
-   **`apply_aligned_timings`**: 
    -   使用 `difflib.SequenceMatcher` 将 Markdown 中的文本标记与 Whisper 识别出的单词标记进行对齐。
    -   通过模糊匹配找到文本在音频中的位置，即使识别存在微小误差也能准确对齐。
-   **`fill_missing_starts` & `fill_span`**: 
    -   如果某些句子没有匹配到（例如 Whisper 没听清），系统会根据前后已知的句子位置和文本长度，自动插值估算出时间。这保证了时间轴的连续性。

---

## 3. 缓存机制

为了避免每次打开页面都运行耗时的 Whisper 识别，后端实现了缓存功能：
-   **存储位置**：在 Markdown 文件同级生成 `.timings.json` 文件。
-   **失效检测**：检查源 Markdown 和音频文件的修改时间、大小。如果文件没变且缓存版本一致，则直接读取缓存。
-   **强制更新**：通过接口参数 `force=1` 可以强制重新生成时间轴。

---

## 4. 环境配置与启动

脚本通过环境变量提供灵活性：
-   `PORT`: 指定监听端口（默认 5173，如果占用会自动递增寻找可用端口）。
-   `WHISPER_MODEL`: 指定使用的模型，如 `tiny.en` (快), `base.en` (推荐), `small.en` (准)。
-   `WHISPER_DEVICE`: 指定运行设备，`cpu` 或 `cuda` (GPU)。

**启动流程**:
1. 查找可用端口。
2. 启动 `ThreadingHTTPServer`（支持并发处理多个请求）。
3. 打印本地访问地址。

---

## 5. 总结

`server.py` 是一个设计精巧的后端程序。它将传统的 Python Web 服务与现代 AI 推理结合，解决了一个痛点：**手动为听力原文打时间轴非常繁琐**。通过 Whisper + 模糊对齐算法，它实现了自动化的、可交互的听力学习体验。