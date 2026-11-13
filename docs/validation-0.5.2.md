# 0.5.2 / DSH 0.2.2-rc.3 适配记录

日期：2026-11-14。平台：Windows x64、Node 24.16.0。宿主：已安装的官方 DSH 桌面运行时 **0.2.2-rc.3**（`resources/app.asar/dsh`）。

## 变更

- `review_health` 的子代理能力探测由已移除的 `dispatch` / `settle` 服务方法改为 `startActivation`。派发路径本来就是 `ctx.subagents.startActivation`，行为不变；修复后 0.2.2 宿主的自检不再把可用的子代理服务报告为不可用。
- 最低 Harness 声明提升到 `>=0.2.2-rc.3`。

## 已核对

- 离线测试 91 项通过、0 跳过（`npm test`，含派发、账本、门禁、证据快照与工作台契约）。
- 对照 0.2.2-rc.3 运行时核对 `ctx.subagents`：`startActivation`、`interrupt`、`sendMessage`、`listDescendants` 存在，`dispatch` / `settle` 已移除，`SubagentActivationSpec` 的 `name` 为可选，现有调用签名兼容。
- `tsc` 构建通过，`lib/` 与源码一致（宿主 CI 会再次校验 `git diff --exit-code -- lib`）。

## 未验证

- 本轮没有在 0.2.2-rc.3 上重新执行真实 agent 回合的 Deep 评审、Web 轨迹查看或 Electron 原生窗口检查；这些沿用 [0.4.4 验收](validation-0.4.4.md) 的边界，不代表 0.2.2 下已重新实测。
- 模型仍为本地受控适配器，不评价生产模型召回率或误报率。
