# 接入、迁移与回滚

## 本地与 DSH

先在 Git 仓库根目录打开会话，运行构建/测试，再调用 review_run。它默认审工作区；指定 staged=true 会固定索引内容；指定 base=main 会审 merge-base 到 HEAD 的提交差异。base 与 staged 不可同时使用。

先保留 review_diff 返回的覆盖范围。遇到超限、符号链接、二进制、模型错误或权限问题，应拆分改动、补领域检查或交给人，不得把失败改成空数组后继续。

review_gate 的 ok=true 只说明当前目标的 AI 层完成且已发表问题均有处置，不代表测试、发布或人工批准通过。

## v0.2 → v0.3

原先只接受 head/findings 的提交方式不能防止跨工作区、旧代码和过期结果串用，现已停用。

1. review_run 返回 runId、targetId 和待完成 tasks。
2. 原生服务可用时自动执行全部阶段；否则每个外部审阅者提交携带 runId/targetId/taskId 的 JSON。
3. 外部结果用 review_report({runId,targetId,results:[...]}) 提交。下一阶段会返回新的任务，不可重复或覆盖已有任务。
4. review_check 也须传 runId、targetId、command，返回 receiptId。不能把随手写的 evidence 文本当作这个收据。
5. review_respond 须带运行编号、目标编号、fingerprint、disposition、至少 20 字符的具体 note。fixed 需修改代码后独立复审。

外部提交无法证明审阅者独立，因此始终不能填补自动门禁。原生运行不允许用 review_report 偷换结果。

默认状态改为 @profile。旧项目内 .dsh-review/state.json 不会被删除；如需迁移取证，可显式指定旧 stateDir，v1 将保留 state.json.v1.backup。旧批准不再有效，需要完整的新审查。

运行超时/失败后可用 runId 恢复。确需放弃时，在当前工具与子任务完全停止后调用 review_run({runId,abandon:true})。被放弃的运行不授予任何批准。达到完成轮次上限后应重新审视方案，不能不断改用别名绕过。

## PR 的完整门禁

先由仓库负责人把 docs/review-policy.example.json 复制为 .github/dsh-review-policy.json，填写实际的可信作者和检查名称/提供方，再提交到受保护基准分支。示例名称不是已经存在的 CI job。

受信任作业需要先完成本轮原生提交审查，随后执行：

```bash
dsh-review-gate --run <本次运行编号> --root <审阅工作区>
```

要求 GITHUB_EVENT_PATH 指向受信任的 pull_request 事件，GITHUB_TOKEN 只有 contents/read、pull-requests/read、checks/read 权限。程序只 GET REST API，以及执行只读 GraphQL 线程查询，不写评论或批准。

检查项：

- AI 审查必须是原生、完整且匹配当前提交，代码/基准不可变化。
- 策略从事件指向的基准提交读取，不接受 PR 工作树改写的策略。
- 每个指定 CI 检查必须来自指定 App、对应当前 HEAD、实际 success；skipped/neutral 不视为成功。
- 每条 review thread 必须解决，人类 change request 不能仍未撤回。
- 批准必须为当前 HEAD 的独立真人 review；机器人、作者本人、旧提交、重复用户与已撤回批准不计数。
- 非可信作者至少两个真人批准；可信作者按风险 0/1/2 人，第二分类器可提高人数。敏感路径不得低于下限。

本地只查看 AI 层时必须显式加 --ai-only。它会输出“未检查 CI 和人工批准”，不得作为完整合并授权。

## 受信任执行边界

不要从 PR 分支安装审阅器、工作流或门禁代码，也不要接收 PR 自带账本。固定审阅器的可信版本，在干净的 profile/临时状态目录生成本次结果；PR 代码只作为材料。运行其测试/安装脚本前使用真正的隔离环境和正常审批。账本是本地审阅记录，不是密码学签名。

仓库负责人仍需实际启用分支保护、必需检查、CODEOWNERS 和新提交撤销旧批准。需要合并队列时，重新针对与主分支合并后的版本验证；插件不会自动配置 GitHub 仓库设置。

只读 API 结果存在查询后的状态变化窗口，不能代替 GitHub 在合并瞬间执行的规则。CI 名称和提供方核对也不能代替保护工作流来源。

## 发布与回滚

PR 模板记录 Testing、Risk、How to revert 和负责人。高风险功能应在宿主项目中保留开关，先内部使用，再分阶段发布。让发布系统保存上一可用版本及回滚命令；发生事故时回滚，并由熟悉代码的人把真实缺陷和干净对照加入评测。

本插件没有自动合并、替人批准、修改分支保护、发布生产代码或自动回滚的动作。不要把安装插件等同于这些流程已经生效。

## 账本异常恢复

损坏账本保持原文件并阻止通过。先停止该工作区所有审阅进程，保存状态与事件日志，然后在新的空白 profile 中重新审阅，不要把损坏文件替换为空文件以伪造原目标通过。

write.lock 只用于极短的同步事务；进程崩溃留下时，必须先确认所有写入进程已停止，再保留诊断并移走该插件状态目录中的锁。不能在活跃写入时清锁。运行租约记录 owner PID；原进程确实退出后可恢复，不能同时运行两组同编号任务。
