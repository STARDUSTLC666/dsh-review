# 变更记录

## 0.2.0（2026-10-17）

把文章里能落地的东西全做进插件，落地不了的生成作业书交给调用方 AI。

- 新增 `review_run`：生成镜头作业书 → 派给子智能体（`ctx.subagents`）→ 收结果 → 过把关层；无宿主能力时返回可执行作业书
- 新增 `review_gate`：未关闭的 blocker/important → `exitCode=1`，供 CI 拒绝合并
- 新增 `review_learn`：把账本里的重复文件/类型沉淀成 `REVIEW.md` 片段
- 新增 `review_issue`：issue 分类 + 复现要求 + 作业书
- 新增 `review_eval`：登记历史 bug commit、打分召回、生成评测作业书
- 把关层抽成 `gate.ts`，`review_report` 与 `review_run` 共用
- 修复：重复结论合并取最严（原先先到先得会把 blocker 降成 important），且同步到返回列表
- 新增 `lens` 归因与越镜记录 `declined`
- 测试 27 项

## 0.1.0（2026-10-17）

首个版本：以证据为准的代码审阅闭环。

- 五个工具：`review_diff` / `review_report` / `review_check` / `review_respond` / `review_status`
- 三档模式（quick / standard / deep），按改动路径自动分级，`REVIEW.md` 可覆盖
- 证据门槛：没有可执行证据的结论记为 `unverified`，不进入可发列表
- 去重：种类 + 文件 + 归一化代码行的指纹，重复只计数不复报
- pre-existing 标记：与 base 版本比对，旧代码里的问题单独归类
- 轮次收敛：默认 3 轮上限，第 2 轮起只看增量
- 噪音度量：处置（fixed / wrong / intentional / wontfix）驱动噪音率与复报率
