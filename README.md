**简体中文** · [English](README.en.md)

# Review

**让代码审阅落到证据和可复查的修复上。**

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

网页版把 `desktop` 改为 `web`；安装后重启对应的 DSH。宿主要求以包声明 `>=0.2.1-rc.3` 为准。

## 开始使用

1. 按安装说明把 @stardustlc/dsh-review 安装到实际使用的 profile，再在目标 Git 仓库创建新会话。
2. 说明审阅范围：当前工作区、暂存改动或指定 Git 基准，并选择合适的审阅深度。
3. 让助手调用 review_run；保留返回的 runId，查看 review_status 中的未完成项。
4. 逐项核对触发条件、代码位置和独立复核证据，修复问题或记录有理由的处置。
5. 代码改变后重新审阅并检查 review_gate；AI 门禁不代替 CI 或人工批准。

可以这样说：

> 审阅当前 Git 改动，逐项给出触发条件和代码证据，先不要修改文件。

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
