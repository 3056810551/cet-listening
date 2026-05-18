# 业界提交规范

本文件用于约束 AI 或人工提交代码时的行为。以后凡是需要提交，请先阅读本文件，再执行 `git status`、审查变更、编写提交信息并提交。

## 1. 提交目标

- 每次提交只做一类事情。
- 提交信息应说明“做了什么”，必要时点明“为什么做”。
- 提交应尽量小、清晰、可回滚。
- 不要把无关改动混进同一次提交。

## 2. 必须遵守的提交规则

- 提交前先看 `git status` 和 `git diff --staged`。
- 如果工作区里有与本次任务无关的改动，不要擅自提交进去。
- 不要提交临时调试代码、无意义日志、注释掉的大段废弃代码。
- 不要提交构建产物、缓存文件、编辑器临时文件，除非仓库明确需要。
- 没有验证过的重大改动，不要直接提交；至少说明未验证项。
- 如果改动较多，优先按功能拆分为多次提交。

## 3. 提交信息规范

采用 Conventional Commits 风格：

```text
<type>(<scope>): <subject>
```

常用 `type`：

- `feat`: 新功能
- `fix`: 修复问题
- `refactor`: 重构，不改变外部行为
- `docs`: 文档更新
- `style`: 纯样式/格式调整，不影响逻辑
- `test`: 测试相关
- `chore`: 杂项、脚本、配置、依赖、维护
- `perf`: 性能优化
- `build`: 构建系统或打包相关
- `ci`: CI/CD 相关

`scope` 规则：

- 只写受影响模块，尽量简短，如 `ui`、`audio`、`parser`、`docs`。
- 如果没有明显模块，可以省略 `scope`。

`subject` 规则：

- 一句话写清本次改动的核心结果。
- 使用动词开头，简洁明确。
- 不写空话，如“update code”“fix bug”。
- 尽量控制在 50 个字符左右，必要时可稍长，但不要冗长。

## 4. 推荐示例

```text
feat(ui): add section-level loop playback
fix(ui): keep transcript action buttons hidden during section loop
refactor(parser): simplify transcript line splitting
docs: add commit workflow for AI-assisted submissions
chore(data_tools): rename export script options
```

## 5. 不推荐示例

```text
update
fix
修改一下
提交代码
final version
```

## 6. AI 提交前检查清单

AI 在提交前必须完成以下检查：

1. 阅读本文件。
2. 执行 `git status`，确认本次准备提交的文件范围。
3. 执行 `git diff` 或 `git diff --staged`，确认没有误提交内容。
4. 判断本次改动属于哪个 `type` 和 `scope`。
5. 用一句明确的话写提交标题。
6. 如有必要，在提交说明中补充验证情况或风险。

## 7. AI 提交执行模板

当我要你提交代码时，请默认按下面流程执行：

1. 先阅读 `AI_COMMIT_GUIDELINES.md`。
2. 查看当前变更范围，只暂存与本次任务直接相关的文件。
3. 生成 1 条符合 Conventional Commits 的提交信息。
4. 向我简要汇报将要提交的内容和提交信息。
5. 执行提交，不要擅自把无关改动一起提交。

## 8. 提交说明模板

简单改动可只写标题：

```text
fix(ui): correct section loop behavior
```

复杂改动可写标题加正文：

```text
fix(ui): correct section loop behavior

- make section navigation loop the whole section instead of first sentence
- keep transcript row actions hidden unless the row itself is hovered or looping
- preserve single-line loop behavior
```

## 9. 本仓库额外约定

- UI 行为修复优先使用 `fix(ui): ...`
- 文案、说明、README 更新优先使用 `docs: ...`
- 数据脚本、工具脚本调整优先使用 `chore(data_tools): ...`
- 纯重构但不改行为时使用 `refactor(...): ...`
- 一次提交尽量聚焦一个问题，例如“section 循环播放修复”应单独提交

## 10. 给 AI 的一句话指令

以后如果我要你提交代码，请先阅读 [AI_COMMIT_GUIDELINES.md](./AI_COMMIT_GUIDELINES.md)，然后按该规范检查变更、生成提交信息，并只提交与当前任务相关的文件。
