# 0.4.4 验证记录（2026-10-28）

Windows 回归 84 项通过、0 跳过。真实 Git 夹具验证工作区/全局 clean 过滤器不执行，原始新增行仍在快照中；info/attributes 的 clean、binary、非 ASCII 伪注释与 linked worktree 均明确阻断，未启用不安全回退。

原 Issue #1 的空白/异文件/远距离证据、原锚点仍存在时误记 fixed、默认 @profile 排除同名仓库目录均覆盖回归。

官方 DSH 0.2.1-rc.4 隔离 profile 执行原生 review_diff / review_run / review_gate。Deep 一轮实际启动 10 个独立子任务；缺陷保留且 gate 不通过。模型为受控本地适配器，不声称生产模型召回率或误报率。Web 实际打开会话轨迹与工具结果，未验证 Electron 原生窗口。

Git info/attributes 有效规则阻止本次 diff，不自动修改仓库设置。此检查不是针对另一个进程持续恶意变更 Git 配置的操作系统沙箱。
