# 设计说明

## 来源

设计参照 Claude Code 团队的审阅流程文章。可迁移的部分与放弃的部分：

| 文章机制 | 本插件的做法 |
|---|---|
| 先验证再给人看 | `review_check` 跑证据；没有证据的结论不发 |
| 多 agent 找 + 投票过滤 | 镜头并行由主流程编排；插件提供镜头计划与证据门槛。投票只在"无法执行验证"时兜底 |
| 风格 / 诊断 / 清理类直接丢 | `DROP_KINDS`，不进入候选 |
| 每条必须被回应 | `review_respond`，未答复单独统计，不计入噪音率分母 |
| 风险分级决定审批人数 | `classifyRisk` + `requiredApprovals`，只给建议 |
| 三轮上限、之后只看增量、不复报 | `roundCap` / `diffOnlyAfterRound` / 指纹去重 |
| 59% 重复告警指向旧代码 | `pre-existing` 标记 |
| 噪音量化（修了/错了/本来如此/不重要） | `Disposition` + `noiseRate` |
| 事故变评测集 | 未实现（路线图） |
| 合并队列、自动批准 | 不做：属流程与权限，插件只产出结论 |

## 为什么"证据"优先于"投票"

找 bug 便宜、判断真假贵。三个模型都说"这是 bug"仍然可能一起错；而一个能跑通的复现脚本不需要民主表决。所以顺序是：

1. 有可执行证据 → 直接可发
2. 没有证据 → 降级为 `unverified`（记账，不发）
3. 只有明确标注"无法执行验证"且模式为 deep 时，才退回多视角一致

## 指纹

`sha256(kind + file + normalize(anchor))`，取前 16 位。

用"锚定的代码行"而不是行号，所以：

- 上方插入代码 → 行号变了，指纹不变
- 重新格式化（空白变化）→ 指纹不变
- 措辞改了、位置没动 → 指纹不变（有意为之：同一条问题不该换个说法再发一次）

## 账本结构

```json
{
  "version": 1,
  "heads": {
    "<sha>": {
      "head": "<sha>",
      "base": "HEAD",
      "round": 2,
      "mode": "standard",
      "posted": { "<fingerprint>": { "file": "...", "line": 3, "severity": "important", "disposition": "fixed", "repeats": 1 } },
      "reviewedFiles": ["src/a.js"],
      "dropped": 3,
      "suppressed": 1,
      "unverified": 2
    }
  }
}
```
