[简体中文](README.md) · **English**

# Review

**Review code with evidence and fixes you can recheck.**

[![npm](https://img.shields.io/npm/v/@stardustlc/dsh-review)](https://www.npmjs.com/package/@stardustlc/dsh-review) [![downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-review-downloads.svg)](https://www.npmjs.com/package/@stardustlc/dsh-review) [![total downloads](https://raw.githubusercontent.com/STARDUSTLC666/dsh-suite/npm-downloads/assets/dsh-review-total-downloads.svg)](https://www.npmjs.com/package/@stardustlc/dsh-review)

**[Install](#install) · [Workflow](#start-using-it) · [Full guide](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.en.md)**

<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-en-mobile-dark.svg">
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-en-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-en-dark.svg">
  <img src="https://raw.githubusercontent.com/STARDUSTLC666/dsh-review/main/docs/assets/intro/workflow-en-light.svg" alt="Review code with evidence and fixes you can recheck. · workflow illustration" width="100%">
</picture>

## Features

- Choose scope and depth for a working tree, staged diff or Git base.
- Inspect triggers, source locations and independent verification.
- Track open items and rerun the gate after code changes.

## Install

Open **Plugins** in the DSH desktop app and install `@stardustlc/dsh-review`. If the CLI is available:

```bash
dsh plugin --profile desktop add @stardustlc/dsh-review
```

For the web profile, replace `desktop` with `web`. Restart that DSH profile after installation. The package’s DSH requirement is `>=0.2.1-rc.3`.

## Start using it

1. Install @stardustlc/dsh-review in the profile you use, then start a new session in the target Git repository.
2. Choose the working tree, staged changes or a Git base, and the appropriate review depth.
3. Ask the assistant to run review_run. Keep its runId and inspect unfinished work with review_status.
4. Check each trigger, code location and independent verification; fix the issue or record a reasoned disposition.
5. Review changed code again and check review_gate. The AI gate does not replace CI or human approval.

Example request：

> Review the current Git diff with triggers and source evidence. Do not modify files yet.

## Before you start

AI reviews and gates still need real tests, CI and human judgment.

Configuration, detailed tools and troubleshooting: [full reference](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.en.md).

## Plugin updates

Check updates at the bottom of the workbench or native plugin details. Automatic checks are on by default; **automatic installation is off**. You choose whether to install and when to restart. Suite-managed components update with their bundle. [Update behavior](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.en.md).

## Documentation

- [Full usage, configuration and limits](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/REFERENCE.en.md)
- [Release notes](https://github.com/STARDUSTLC666/dsh-review/blob/main/CHANGELOG.md)
- [Validation scope and history](https://github.com/STARDUSTLC666/dsh-review/blob/main/docs/VALIDATION.md)

## Feedback and contributions

If the plugin helps, a Star makes it easier for others to discover. Report problems or suggest improvements in [Issues](https://github.com/STARDUSTLC666/dsh-review/issues); code and documentation [PRs](https://github.com/STARDUSTLC666/dsh-review/pulls) are welcome. Include versions and reproduction steps, and remove credentials from reports.

## License

[MIT](https://github.com/STARDUSTLC666/dsh-review/blob/main/LICENSE)
