**简体中文** · [English](README.en.md)

# Review

**让代码审阅落到证据和可复查的修复上。**

DeepSeek Harness（`>=0.2.2-rc.3`）证据驱动代码审阅插件：通过独立上下文发现缺陷、多审阅员复核投票、风险分级与增量轮次收敛跟踪改动，并支持快速/标准/深度三种审阅门禁。

[![npm](https://img.shields.io/npm/v/@stardustlc/dsh-review)](https://www.npmjs.com/package/@stardustlc/dsh-review) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-review-downloads.svg)](https://www.npmjs.com/package/@stardustlc/dsh-review) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-review-total-downloads.svg)](https://www.npmjs.com/package/@stardustlc/dsh-review)

**[安装使用](#安装) · [使用流程](#开始使用) · [完整说明](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.zh.md)**

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-zh-mobile-dark.svg">
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-zh-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-zh-dark.svg">
  <img src="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-zh-light.svg" alt="让代码审阅落到证据和可复查的修复上。 · 流程示意" width="100%">
</picture>

## 功能

- 为工作区、暂存改动或 Git 基准选择范围与深度。
- 核对触发条件、代码位置和独立复核证据。
- 跟踪未完成项，代码改变后再检查门禁。

## 安装

在 DSH 桌面版「插件」面板安装 `@stardustlc/dsh-review`。已配置命令行时也可使用：

```bash
dsh plugin --profile desktop add @stardustlc/dsh-review
```

网页版把 `desktop` 改为 `web`；安装后重启对应的 DSH。宿主要求以包声明 `>=0.2.2-rc.3` 为准。

## 开始使用

无需记忆底层工具名或审阅单号，按人类日常提交流程四步闭环：

1. **在代码仓库发起审阅**：打开目标 Git 仓库会话，直接告诉助手要审哪里（当前未提交改动、暂存区还是对比 `main` 分支）以及赶时间程度（快速扫一眼 / 标准审阅 / 发版前深度审阅）。
2. **只看有证据的真问题**：插件会自动派发独立视角发现缺陷并做交叉复核，只把**带具体文件行号、触发条件与验证依据**的问题列给你，过滤主观吹毛求疵。
3. **逐项拍板修复或豁免**：对认可的缺陷直接说「把第 1、2 项修掉」，对有意为之的设计直接说明理由归档（无需反复拉扯）。
4. **改完复查过门禁**：修复后让助手复测本轮改动并核对门禁是否清零，确认通过后再跑本地测试与提交 PR。

常用场景怎么对助手说（可直接复制）：

- **提交 / 发 PR 前自检**：`帮我标准审阅一下当前分支相对 main 的改动，先别改代码，按严重度列出触发条件和代码证据。`
- **高风险模块深度把关**：`对这次鉴权与并发改动做一次深度代码审阅，重点排查竞态、越权和异常回滚漏口。`
- **修完复核闭环**：`把刚才确认的高优问题修掉，然后复查一次审阅门禁看还有没有遗留项。`

## 开始前要知道

AI 审阅与门禁仍需结合实际测试、CI 和人工判断。

配置、完整工具与排错见[详细使用说明](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.zh.md)。

## 插件更新

在工作台或原生插件详情页底部检查更新。默认自动检查，**默认不自动安装**；是否安装、何时重启由你决定。Suite 管理的组件随整包更新。[查看更新规则](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.zh.md)。

## 文档

- [详细使用、配置与边界](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.zh.md)
- [更新记录](https://github.com/STARDUSTLC666/dsh-review/blob/main/CHANGELOG.md)
- [验证范围与历史](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/VALIDATION.md)

## 反馈与贡献

如果插件帮到了你，欢迎 Star，让更多人发现它。问题和建议请提交 [Issues](https://github.com/STARDUSTLC666/dsh-review/issues)，也欢迎代码与文档 [PR](https://github.com/STARDUSTLC666/dsh-review/pulls)。反馈时附上版本与复现步骤，并移除凭据。

## License

[MIT](https://github.com/STARDUSTLC666/dsh-review/blob/main/LICENSE)

<a id="使用"></a>
<a id="审阅如何完成"></a>
<a id="十个工具"></a>
<a id="检查权限与证据"></a>
<a id="接入仓库流程"></a>
<a id="限制"></a>
<a id="跳过"></a>
<a id="坏掉长什么样"></a>
<a id="敏感路径"></a>
<a id="状态与配置"></a>

证据执行会跟随当前会话的原生或 PTC 执行器，保留宿主权限与取消控制。遇到拒绝或不完整回执时不会把检查记为通过。
