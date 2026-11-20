# 变更记录

## 0.5.14 (2026-11-20)

- 升级共享更新组件至 0.2.10，移除跨插件右下角浮动提醒，保留工作台及插件详情页更新控制。

- Git 引号路径保留补充平面 Unicode，正确解码重命名/复制旧路径；快照在读入前执行剩余字节预算，按块防止文件增长导致无界读取。

## 0.5.13 (2026-11-20)

- 更新共享更新组件至 0.2.9，修复最终空闲检查期间取消仍启动包更新的问题，以及已取消网络请求的 Promise 处理和响应释放；保留审阅、证据及门禁契约。
- 修复 review_check 参数 Schema 与官方宿主子集不兼容导致后续工具注册中断的问题，保留超时范围的运行时校验。

## 0.5.12 (2026-11-20)

- 升级共享更新组件至 `@stardustlc/dsh-updates@0.2.7`：对话页「有新版本」提醒浮卡支持无交互 15 秒自动收起（悬停、聚焦、查看记录或确认弹窗时自动暂停，安装成功提示 6 秒收起，安装中/失败/需要重启仍保持常驻不隐藏）。
- Upgrade `@stardustlc/dsh-updates` to `0.2.7`: auto-dismiss idle update reminder cards after 15s and silent complete cards after 6s while pausing on hover/focus/notes/dialogs and keeping active, failed, or restart-required cards pinned.

## 0.5.11 (2026-11-20)

- 升级共享更新组件至 `@stardustlc/dsh-updates@0.2.6`：端到端验收修复浮卡与日历按钮重叠、详情页/工作台挂载时瞬时让位及 `package-moved` / 包管理器报错诊断文案，继续保持过期检查自动刷新与 `bundle-in-use` 指导。
- Upgrade `@stardustlc/dsh-updates` to `0.2.6`: E2E-verified fixes for floating Calendar FAB clearance, immediate reminder yield on native detail/workbench mount, and clearer `package-moved` / package-manager error messages, alongside auto-refresh and `bundle-in-use` guidance.

## 0.5.10 (2026-11-18)

- 升级共享更新组件至 `@stardustlc/dsh-updates@0.2.5`：独立安装插件详情页底栏去重（保留组合包组件委派与对话页热更新卡片），补齐 `bundle-in-use` 组合包占用提示说明，并在检查结果过期或远端版本变更时自动刷新元数据，彻底消除 `check-first` 卡顿。
- Upgrade `@stardustlc/dsh-updates` to `0.2.5`: deduplicate standalone native plugin detail footers while keeping Suite delegation and in-chat reminder cards, surface clear `bundle-in-use` guidance, and automatically refresh expired update checks without `check-first` stalls.

## 0.5.9 (2026-11-18)

- 升级共享更新组件至 `@stardustlc/dsh-updates@0.2.4`：对话页新增一键热更新提醒卡片，自动检查周期缩短至 6 小时，手动热更新后可顺手开启包含兼容功能小版本的空闲自动更新。
- Upgrade `@stardustlc/dsh-updates` to `0.2.4`: add an actionable in-chat hot-update reminder card, 6-hour background update checks, compatible minor+patch idle auto-updates, and a post-update opt-in prompt.

## 0.5.8 (2026-11-18)

- 同步 `@stardustlc/dsh-updates` 0.2.3：侧边栏工作台平时默认隐藏底部更新栏（零高度占用），仅在检测到兼容新版本或执行更新时浮现单行精简提示条；完整更新设置与检查入口统一保留在 DSH「插件」详情页底部。
- Sync `@stardustlc/dsh-updates` 0.2.3: keep the sidebar workbench update footer hidden by default when up-to-date, surfacing a single-line compact strip only for actionable updates or active jobs while retaining full controls in native Plugin Details.

## 0.5.7 (2026-11-18)

- 重写中英文代码审阅上手流程：去除让用户手动记忆内部工具名与 `runId` 的说明，改为「指定改动范围与深度 → 核对带行号与触发条件的真问题 → 修复或说明理由 → 复查门禁」四步闭环与常用话术。
- Rewrite bilingual code-review onboarding into a natural 4-step PR loop without internal tool-name/runId boilerplate, complete with copy-ready review prompts.

## 0.5.6 (2026-11-18)

- 更新区底部新增克制、无打扰的 GitHub 点赞与问题反馈快捷链接，并完善中英文检索关键词。
- Add subtle, non-intrusive GitHub Star and issue feedback links in the update footer, and expand search keywords.

## 0.5.5 (2026-11-18)

- 同步 `@stardustlc/dsh-updates` 0.2.1：恢复 Suite 整包统一更新（移除独立拆包迁移），保留整包与独立插件的原地热更新与失败自动回滚。
- Sync `@stardustlc/dsh-updates` 0.2.1: restore unified Suite bundle updates (removing standalone conversion) while retaining in-place hot reload and automatic rollback.

## 0.5.4 (2026-11-18)

- 深度适配 DSH 0.2.2：补齐 manifestVersion 1 与双语元数据；合并缓存仓库 Git 元数据查询并并行化只读检查以显著提升 Windows 响应速度，增强账本原子重命名重试与 Git Bash 路径探测。
- Deeply adapt to DSH 0.2.2: add manifestVersion 1 and bilingual locale metadata; cache combined Git metadata probes and parallelize read-only target queries for faster Windows execution, add EPERM/EACCES rename retries, and mark read-only tools concurrency-safe.

## 0.5.3 (2026-11-17)

- 在原生插件详情页单独检查和安装兼容版本。自动安装默认关闭，可为该插件开启空闲时的稳定补丁更新。
- Check and install compatible versions separately from the native plugin details. Automatic installation is off by default. Enable it for this plugin to apply stable patches while idle.

## 0.5.2 (2026-11-14)

- 适配 DSH 0.2.2-rc.3：`review_health` 的子代理能力探测改用 `startActivation`（0.2.2 已移除旧的 dispatch / settle 服务方法），最低 Harness 声明提升至 0.2.2-rc.3。
- Support DSH 0.2.2-rc.3: `review_health` now probes `startActivation`, because 0.2.2 removed the legacy dispatch / settle service methods; raise the minimum Harness declaration to 0.2.2-rc.3.

## 0.5.1 (2026-11-04)

- 同步共享界面：嵌入设置时继承宿主底色，输入框跟随主题，空状态保持可读宽度；新版 DSH 可显示插件设置图标。
- Align embedded surfaces, themed inputs, readable empty states and optional native settings icons.
- 证据检查适配原生批量调用与 TypeScript/Python PTC transport，保持权限和取消边界。
- Dispatch evidence through native batches or selected TypeScript/Python PTC transports with permission and cancellation checks.


## 0.5.0 (2026-11-03)

- 新增只读的 review_health：报告 Git 工作区、插件依赖的宿主服务（子智能体、权限预设、作业管理）、本轮生效的预算与三档模式，不作审阅结论；首次使用和环境排查先跑它。
- 首次使用路径明确为 review_diff（看范围、风险、模式与预算）→ review_run → review_gate；README 中英文同步。
- 三档审阅模式在调用处可见：mode 参数说明与 review_diff 的 modeOptions 列出各自的问题类别、复核人数、汇总者与预计调用量，模式适用说明由 modes.ts 统一提供。
- 工作区尚无审阅记录时，review_status 与 review_gate 返回 nextStep，直接说明下一步该调用哪个工具，而不是只报零值或不通过。
- State the first-use path (review_diff → review_run → review_gate) and expose the three modes with their budgets at the call site instead of only in the README; empty workspaces now explain the next tool call.

## 0.4.8 (2026-10-30)

- 重整中英文首页：用途、三步流程图、安装入口与操作示例；详细配置与边界集中到完整说明。
- 保留下载统计、独立更新选择、问题反馈和贡献入口；原封面与运行功能保留。
- Refresh bilingual landing pages, workflow artwork, quick starts and reference navigation.


## 0.4.7 (2026-10-30)

- 原生插件列表与详情新增专门生成的鲸鱼娘图标：大头像、独立功能符号、透明留白，适合 30 / 36 px 显示；原封面保留。
- Add purpose-made whale-girl artwork with a distinct function emblem, transparent padding and small-size readability; preserve the original cover.


## 0.4.6 (2026-10-29)

- 补齐中英文使用流程：准备、入口、具体操作与结果核对；新增累计 npm 下载徽章并保留月统计。
- Add practical getting-started workflows and lifetime npm download badges alongside monthly counts.

## 0.4.5 (2026-10-29)

- 同步仓库与 npm 的简明介绍、中英文 README 和反馈入口；本次为文档与包元数据更新。
- Sync npm descriptions and both README guides with the repository, including issue and pull-request links.

## 0.4.4 (2026-10-28)

- 隔离 Git 的工作区/全局属性转换，避免仓库 clean 过滤器执行并隐藏真实改动；固定补丁前后缀和行首格式。
- 对无法隔离的 info/attributes 规则明确报告审查未完成，不把空补丁误报为通过；linked worktree 同样检查 common Git 目录。

## 0.4.3 (2026-10-27)

- 修复分批更新时的新旧更新控件混用：保留原页面、草稿与安装保护，空闲后接管旧控制器，兼容旧入口。

## 0.4.2 (2026-10-27)

- 更新控件移至原有工作台或原生插件详情页底部；更新记录与选项原地展开，移除独立更新菜单与页面。
- 保留原页面操作与草稿，自动安装默认关闭；安装前确认，遇到未保存修改或运行任务时暂停。

## 0.4.1 (2026-10-27)

- Refresh shared update controls for independent and Suite installations, with explicit whole-bundle scope.
- Keep automatic installation off by default and preserve independent installation behavior.

## 0.4.0 (2026-10-26)

- Add this plugin’s own update controls and independent preferences. Automatic installation stays off until explicitly enabled.
- Confirm manual installs, preserve local sources and disabled state, pause for tasks or unsaved changes, and use native DSH recovery without forced restarts.
- Require the public DSH 0.2.1-rc.3 update APIs; Suite components remain managed through Suite.

## 0.3.1（2026-10-26）

- 复核证据绑定候选位置与非空源码锚点；旧 finding 仍存在或缺少原文件覆盖时不自动标为已修复。仅排除真实账本目录，默认配置不再隐藏仓库同名目录。
- Windows 回归 78 项通过、0 项跳过；宿主与未验收范围见[本次记录](docs/validation-0.3.1.md)。

## 0.3.0（2026-10-17）

重做 v0.2 中尚未可靠接通的审阅闭环，按实际执行和证据决定是否完成。

- 修复原生子智能体接线：真实调用 agent、服务 receiver、prompt blocks、独立上下文和 activation.result 生命周期。
- 找问题、风险分类、逐条多数复核和 Deep 汇总分阶段执行；未完成/缺结果不再误放行。
- 每轮绑定快照和唯一编号；修复中文路径、索引/工作区混淆、大 diff 静默截断、旧文件复用和跨仓库缓存。
- 证据命令改经宿主受控终端；遵守权限、取消和后台作业清理，支持 Windows 官方 pwsh 预设桥接 Git Bash。
- 账本改为事务与原子更新；损坏阻塞，旧版证据保留但不继承批准。
- 三轮上限按完成轮次计算，后续复审使用真实增量行；新文件仍可审，旧问题须重新验证。
- 新增只读 GitHub 门禁 CLI，固定基准策略，核对 CI、线程与同提交真人批准；不执行合并或代批。
- 评测改为人工缺陷标签与干净对照的一对一匹配，冻结预测、区分未运行覆盖，避免无关 finding 冒充召回。
- 更新中英文说明、迁移/回滚文档、PR 模板与 Windows/Linux CI。
- 包名改为 @stardustlc/dsh-review，避免未加作用域的同名包指向另一作者仓库。

v0.2 的 head/findings 手工报告不再兼容，请改用 runId/targetId/taskId。旧版记载仅作为历史，当前能力与验证边界以 README 和 docs/VALIDATION.md 为准。

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
