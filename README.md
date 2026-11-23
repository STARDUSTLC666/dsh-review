**简体中文** · [English](README.en.md)

# Review

> **让代码审阅落到可验证的证据与可复查的修复门禁上。**

DeepSeek Harness（`>=0.2.2-rc.3`）证据驱动代码审阅插件：独立上下文发现缺陷、多审阅员交叉复核投票、按风险分级跟踪修复，并支持快/标/深三档门禁校验。

[![npm](https://img.shields.io/npm/v/@stardustlc/dsh-review)](https://www.npmjs.com/package/@stardustlc/dsh-review) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-review-downloads.svg)](https://www.npmjs.com/package/@stardustlc/dsh-review) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-review-total-downloads.svg)](https://www.npmjs.com/package/@stardustlc/dsh-review)

**[核心能力](#核心能力) · [安装](#安装) · [快速上手](#开始使用) · [完整说明](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.zh.md)**

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-zh-mobile-dark.svg">
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-zh-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-zh-dark.svg">
  <img src="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-zh-light.svg" alt="让代码审阅落到证据和可复查的修复上。 · 流程示意" width="100%">
</picture>

## 核心能力

| 模块 | 核心特性 |
| :--- | :--- |
| **灵活范围与三档深度** | 支持工作区、暂存区与 Git 基准对比；按风险自动或手动选择 **快速 / 标准 / 深度** 审阅门禁 |
| **独立发现与交叉复核** | 独立上下文视角定位缺陷，多审阅员复核投票过滤主观噪音，只输出带行号、触发条件与证据的真问题 |
| **修复收敛与门禁复查** | 逐项跟踪待修或豁免项，改动后增量复测确认门禁清零；遵循当前原生/PTC 执行器权限与取消控制 |

## 安装

在 DSH 桌面版「插件」面板安装 `@stardustlc/dsh-review`，或使用命令行：

```bash
dsh plugin --profile desktop add @stardustlc/dsh-review
```

网页版将 `desktop` 改为 `web`，安装后重启 DSH。宿主要求：`>=0.2.2-rc.3`（独立配套插件，不在 `dsh-suite` 18 件套内）。

## 开始使用

1. **发起审阅**：在目标 Git 仓库会话中说明范围（未提交 / 暂存区 / 对比 `main`）与深度（快速 / 标准 / 深度）。
2. **核对证据清单**：查看按严重度排序的缺陷列表，每项附带具体文件行号、触发条件与验证依据。
3. **拍板修复或豁免**：确认要修的缺陷交由助手整改，对有意为之的设计说明理由归档。
4. **复查过门禁**：修复后复测本轮改动，确认门禁清零再跑本地测试与提交 PR。

### 常用对话示例

- **发 PR 前自检**：`帮我标准审阅当前分支相对 main 的改动，先别改代码，按严重度列出触发条件和代码证据。`
- **高风险深度把关**：`对这次鉴权与并发改动做深度审阅，重点排查竞态、越权和异常回滚漏口。`
- **修完复核闭环**：`把确认的高优问题修掉，然后复查一次审阅门禁看还有没有遗留项。`

## 开始前要知道

- AI 审阅与门禁仍需结合真实测试、CI 与人工判断。
- 证据执行沿用当前会话的原生或 PTC 执行器，保留宿主权限与取消控制；拒绝或不完整回执绝不计为通过。
- 详细配置、十个工具与排错见 [完整说明](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.zh.md)。

## 插件更新

在原生插件详情页底部检查更新。默认自动检查，**默认不自动安装**。

## 文档与反馈

- [完整使用、配置与边界](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.zh.md) · [更新记录](https://github.com/STARDUSTLC666/dsh-review/blob/main/CHANGELOG.md) · [验证历史](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/VALIDATION.md)
- 欢迎 Star、提交 [Issues](https://github.com/STARDUSTLC666/dsh-review/issues) 与 [PR](https://github.com/STARDUSTLC666/dsh-review/pulls)（反馈请附版本与复现步骤，并移除凭据）。

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
