# dsh-review

让 agent 先读代码、人只读结论的审阅插件。它不替你"看一眼"，它管的是：**哪些结论配发出去**。

机制照搬 Claude Code 团队的审阅流程，能自动化的一律做进插件；需要判断的部分生成**作业书**交给调用方 AI。

## 十个工具

| 工具 | 作用 |
|---|---|
| `review_run` | **一键审阅**：生成各镜头作业书 → 派给子智能体并行审 → 收结果 → 过证据/去重/轮次把关。宿主无子智能体时返回可直接执行的作业书。 |
| `review_diff` | 只出计划：读 diff、按风险选模式、加载 `REVIEW.md`、给出镜头与预算。 |
| `review_report` | 手工提交结论（外部审阅者产出时用），走同一套把关。 |
| `review_check` | 为结论跑证据：执行命令/测试，返回退出码与输出。 |
| `review_respond` | 记录处置：`fixed` / `wrong` / `intentional` / `wontfix`。 |
| `review_status` | 噪音率、复报率、未验证数、**按镜头归因**。 |
| `review_gate` | CI 门禁：有未关闭的高优先级结论时 `ok=false`、`exitCode=1`。 |
| `review_learn` | 把重复模式沉淀成 `REVIEW.md` 规则片段。 |
| `review_issue` | issue 分诊：分类 + 复现要求 + 交给 AI 的作业书。 |
| `review_eval` | 评测集：登记历史 bug commit、打分召回、生成评测作业书。 |

## 三档模式

| 模式 | 镜头 | 每条验证 | 场景 |
|---|---|---|---|
| quick | 1（正确性） | 1 | 文档、单文件小改 |
| standard（默认） | 4 | 1 | 普通改动 |
| deep | 4 | 3 + arbiter | 计费、迁移、CI、安装器 |

模式由**改动**决定：敏感路径自动 deep，纯文档自动 quick；`REVIEW.md` 或参数可覆盖。
风险等级（low/medium/high）是独立维度，只影响"建议几个人看"。

## 两个运行档位

| 宿主能力 | review_run 行为 |
|---|---|
| 有 `subagents` 服务 | 起 N 个子智能体并行审，各自有工具、能跑证据，插件收 JSON 后统一把关 |
| 没有 | 生成作业书落盘，返回 `prompt + outFile`，由调用方 AI 执行完再 `review_report` |

这就是"插件能做的自己做，做不了的把活派给用户的 AI"。

## 把关层（所有结论都过这一关）

风格类丢弃 → 指纹去重（**合并取最严 + 证据并集**）→ 增量过滤 → `pre-existing` 标记 →
严重度下限 → **证据门槛（无证据记 unverified，不发）** → nit 上限 → 单轮上限。

## 仓库级规则：REVIEW.md

```markdown
## 跳过
- vendor/**
- **/*.lock

## 限制
max_nits: 2
severity_floor: important
mode: standard

## 坏掉长什么样
- 文档：说的是错的
- 配置：路由错了

## 敏感路径
- src/billing/**
```

## 账本

`.dsh-review/` 下：`state.json`（按 head 记账）、`ledger.jsonl`（事件流）、`raw/`（各镜头产出）、`triage/`、`eval/`。

## 安装

```bash
dsh plugin --profile web add dsh-review
```

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `stateDir` | `.dsh-review` | 账本目录 |
| `roundCap` | `3` | 同一 head 最多几轮 |
| `diffOnlyAfterRound` | `2` | 从第几轮起只看增量 |
| `maxFindings` | `20` | 单轮上限 |
| `maxNits` | `2` | 单轮 nit 上限 |
| `severityFloor` | `important` | 低于此不发 |
| `evidenceRequired` | `true` | 无证据降级为 unverified |
| `commandTimeoutMs` | `120000` | 证据命令超时 |

## 与文章对照

| 文章机制 | 本插件 |
|---|---|
| 先验证再给人看 | `review_check` + 证据门槛 |
| 多 agent 并行找 | `review_run` 派发子智能体；无宿主能力时出作业书 |
| 投票过滤 | 证据优先；投票只用于"无法执行验证"的结论（`decliners` 记录） |
| 风格类直接丢 | `DROP_KINDS` |
| 每条必须被回应 | `review_respond` + `review_gate` 拒绝合并 |
| Pre-existing 标记 | 与 base 比对 |
| 三轮上限 / 只看增量 / 不复报 | `roundCap` / `diffOnlyAfterRound` / 指纹 |
| 风险分级 | `classifyRisk` + 建议人数（不代替人批准） |
| 噪音量化 | 四态处置 + 按镜头归因 |
| 事故变评测集 | `review_eval` |
| 修在源头 | `review_learn` |
| 合并队列 / flag / 灰度 | 不做：属发布系统 |

