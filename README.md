# dsh-review

让 agent 先读代码、人只读结论的审阅插件。它不替你"看一眼"，它管的是：**哪些结论配发出去**。

机制照搬 Claude Code 团队的审阅流程（`How the Claude Code team does code review`），只保留能在单机插件里落地的部分。

## 它解决什么

agent 写代码之后，最容易失控的不是"审不出来"，而是**审得太多**：

- 每条都像真的，人得逐条判断 → 注意力被耗尽
- 同一处问题每轮都再报一次 → 永远收敛不了
- 改一行的 PR 背上一堆旧代码的债 → 作者失去信任

所以这个插件把三件事做成硬约束：**没有可执行证据不发**、**同一条只发一次**、**三轮之后只看增量**。

## 五个工具

| 工具 | 作用 |
|---|---|
| `review_diff` | 读 diff，按风险自动选模式（quick / standard / deep），加载 `REVIEW.md`，给出并行 finder 的镜头与预算。只出计划，不出结论。 |
| `review_check` | 为结论跑证据：执行命令/测试，返回退出码与输出摘要。 |
| `review_report` | 提交本轮结论。插件负责丢风格类、按指纹去重、标 pre-existing、卡证据、卡 nit 上限、执行轮次上限。 |
| `review_respond` | 记录处置：`fixed` / `wrong` / `intentional` / `wontfix`。这是噪音率的唯一来源。 |
| `review_status` | 噪音率、复报率、未验证数、类型分布。改 prompt 前后对比这个数。 |

## 三档模式

| 模式 | 镜头 | 每条验证 | 典型场景 |
|---|---|---|---|
| quick | 1（正确性） | 1 | 文档、单文件小改 |
| standard（默认） | 4（正确性 / 数据状态 / 破坏性变更 / 安全） | 1 | 普通改动 |
| deep | 4 + 交叉复检 | 3 + arbiter | 计费、迁移、CI、安装器 |

模式由**改动**决定，不由作者决定：敏感路径自动 deep，纯文档自动 quick。`REVIEW.md` 或参数可覆盖。

风险等级（low / medium / high）是另一个维度，只影响"建议几个人看"，不影响审阅深度。

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

`.dsh-review/` 下：

- `state.json` —— 按 head 记账（轮次、已发结论、已审文件）
- `ledger.jsonl` —— 追加式事件流（轮次、未验证、处置）

账本可以提交进仓库，让团队共享"这条已经说过了"。

## 安装

```bash
dsh plugin --profile web add dsh-review
```

或在 profile 的 `cordis.patch.yml` 里：

```yaml
- id: review
  name: 'dsh-review'
  config:
    roundCap: 3
    evidenceRequired: true
    stateDir: .dsh-review
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
| `evidenceRequired` | `true` | 没有证据的结论降级为 unverified |
| `commandTimeoutMs` | `120000` | 证据命令超时 |

## 设计取舍

- **证据优先于投票**：能跑脚本复现的，不需要三个模型投票；只有无法执行验证时，才退回到"多视角一致"。
- **不复报**：指纹 = 种类 + 文件 + 归一化代码行，重排、加空行、rebase 都不会让同一条结论变新。
- **pre-existing 单独标**：不让改一行的人背旧债。
- **插件不批准**：它只产出结论与建议人数，批准永远是人（或主流程）的事。

## 状态

v0.1.0：单机 diff 审阅闭环。PR 评论、issue 分诊、评测集（把历史 bug 变成回归基线）在路线图里。
