# 变更记录

## 0.1.0（2026-10-17）

首个版本：以证据为准的代码审阅闭环。

- 五个工具：`review_diff` / `review_report` / `review_check` / `review_respond` / `review_status`
- 三档模式（quick / standard / deep），按改动路径自动分级，`REVIEW.md` 可覆盖
- 证据门槛：没有可执行证据的结论记为 `unverified`，不进入可发列表
- 去重：种类 + 文件 + 归一化代码行的指纹，重复只计数不复报
- pre-existing 标记：与 base 版本比对，旧代码里的问题单独归类
- 轮次收敛：默认 3 轮上限，第 2 轮起只看增量
- 噪音度量：处置（fixed / wrong / intentional / wontfix）驱动噪音率与复报率
