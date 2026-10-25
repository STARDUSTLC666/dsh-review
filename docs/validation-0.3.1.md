# 0.3.1 验证记录

日期：2026-10-26。官方 Windows 宿主：DSH 0.2.1-rc.3。

## 行为变化

复核证据绑定候选位置与非空源码锚点；旧 finding 仍存在或缺少原文件覆盖时不自动标为已修复。仅排除真实账本目录，默认配置不再隐藏仓库同名目录。

## 验证与限制

- Windows 本地：78 项，78 通过、0 跳过；没有把跳过计为通过。
- 官方 RC.3 原生 tools.execute 与审阅子代理验收通过：19 次工具调用，覆盖独立复核、旧快照、真实修复、只读权限、取消和不可信手工报告。模型为本地合成适配器，未评测真实模型的审阅质量。
- GitHub 的跨平台 CI 和 npm 发布完整性以该版本工作流及 registry 为准；本记录不把本地测试等同于已发布。

## English

Verification requires nonblank snapshot anchors near the candidate. Existing findings remain unresolved when their original anchor still exists or coverage is missing. Only the actual managed ledger directory is excluded.

Runtime/account limits are listed above. Synthetic peers and model adapters do not establish live account delivery or model quality.
