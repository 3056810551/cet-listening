# CET-6 听力项目优化与功能规划 (Roadmap)

本项目已具备坚实的基础（LRC 级对齐、流式播放、Markdown 解析）。为了将其提升为专业级的听力训练工具，建议从以下四个维度进行迭代优化：

## 1. 核心学习功能 (Pedagogical Features)
*   **AB 段落循环 (AB Repeat)**
    *   允许用户在原文中通过拖拽或点击设置 A/B 点。
    *   针对当前选中的句子进行单句循环播放（精听模式）。
*   **点击查词 (Instant Lookup)**
    *   集成扇贝、有道等词典 API。
    *   点击原文单词立即弹出悬浮窗显示释义、音标，并支持一键收藏至生词本。
*   **听写/填空模式 (Dictation Mode)**
    *   **挖空练习：** 随机隐藏句子中的关键词，用户输入正确单词后方可跳转下一句。
    *   **全文听写：** 提供输入框，根据音频输入文字，系统实时比对并标红错误点。
*   **波形图交互 (Waveform Integration)**
    *   使用 `wavesurfer.js` 渲染音频波形。
    *   在波形图上标注句子边界，支持视觉化精确跳转。

## 2. 交互体验与 UI (User Experience)
*   **深色模式 (Dark Mode)**
    *   基于 CSS 变量实现一键切换主题，适配夜间高强度学习。
*   **移动端增强 (Mobile Optimization)**
    *   **锁屏控制：** 利用 `Media Session API` 在手机锁屏控制播放、查看当前句子。
    *   **手势操作：** 双击屏幕左右侧快进/快退，长按屏幕任意位置倍速播放。
*   **快捷键矩阵 (Keyboard Shortcuts)**
    *   `Space`: 播放/暂停 | `J/L`: 快退/快进 | `K`: 循环当前句 | `N/P`: 上下句切换。

## 3. 技术架构优化 (Technical Improvements)
*   **模块化重构**
    *   将 `app.js` 拆分为 `Player.mjs`, `Transcript.mjs`, `Catalog.mjs` 等 ES Modules。
    *   引入 `Petite-Vue` 等轻量级框架管理视图状态。
*   **后端增强 (FastAPI)**
    *   由简单的 Python 静态服务器迁移至 FastAPI，支持异步流处理和搜索接口。
    *   **全文检索：** 实现搜索功能，快速定位包含特定词汇的听力套题。
*   **离线访问 (PWA)**
    *   配置 Service Worker 和 Manifest，实现音频与原文的本地缓存，支持断网学习。
*   **数据存储方案**
    *   使用 SQLite 替代 `tracks.json` 以应对数据量增长后的查询性能瓶颈。

## 4. 自动化生产力 (Automation)
*   **AI 自动对齐 (AI Alignment)**
    *   **Whisper 集成：** 编写 Python 脚本，利用 OpenAI Whisper 自动识别音频并生成带时间戳的 JSON，彻底取代手动标注或简单估算。
    *   **纠错工具：** 提供一个 Web 端的简单界面，允许用户微调 AI 生成的时间轴。
*   **资源自动抓取**
    *   编写爬虫自动从真题网站下载最新的音频、原文及 PDF。
    *   **FFmpeg 预处理：** 自动将音频转换为更适合 Web 端的比特率（如 64kbps Opus/AAC）。

---

## 建议实施优先级
1.  **高：** AB 循环、深色模式、Media Session API (提升基础体验)。
2.  **中：** 点击查词、模块化重构、AI 自动对齐 (增强学习深度与生产力)。
3.  **低：** 听写模式、PWA、SQLite 迁移 (进阶扩展)。
