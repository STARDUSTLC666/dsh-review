/**
 * 给"审阅者"的完整作业书。插件自己跑不了的部分，这些文本就是交给用户 AI 的指令。
 *
 * @module dsh-review/lenses
 */

import type { Lens, Mode } from './modes.js'
import type { ReviewRules } from './rules.js'

export const FINDING_SCHEMA = [
  '{',
  '  "lens": "<镜头 id>",',
  '  "findings": [',
  '    { "file": "src/a.js", "line": 12, "kind": "correctness|state|breaking|security",',
  '      "severity": "blocker|important|nit", "message": "一句话说清后果",',
  '      "anchor": "该缺陷所在的那一行原文（用于稳定指纹，必须逐字复制）",',
  '      "evidence": "你实际跑过的命令 + 关键输出；跑不了就留空字符串" }',
  '  ],',
  '  "declined": [ { "file": "src/b.js", "line": 3, "why": "为什么这条不属于本镜头" } ]',
  '}',
].join('\n')

export interface LensTask {
  id: string
  title: string
  outFile: string
  prompt: string
}

export interface LensPromptInput {
  lens: Lens
  root: string
  base: string
  mode: Mode
  rules: ReviewRules
  outFile: string
  maxFindings: number
}

export function buildLensPrompt(input: LensPromptInput): string {
  const signals = input.rules.failureSignals.length > 0
    ? input.rules.failureSignals.map(s => '- ' + s).join('\n')
    : '- （仓库没有写 REVIEW.md，按通用判据：崩、算错、丢数据、被滥用）'
  const skip = input.rules.skip.length > 0 ? input.rules.skip.join('、') : '（无）'
  return [
    '你是代码审阅流水线里的「' + input.lens.title + '」镜头。只做这一件事，不要越镜。',
    '',
    '仓库：' + input.root,
    '对比基准：' + input.base,
    '改动查看：在仓库根执行 git diff ' + input.base + '（或工作区未提交改动）',
    '模式：' + input.mode,
    '',
    '你的判据：' + input.lens.focus,
    '这个仓库"坏掉"长什么样：',
    signals,
    '明确跳过：' + skip,
    '',
    '硬性要求（违反任何一条，产出作废）：',
    '1. 只报本次改动引入的问题。同一行在基准版本里就存在 → 不报（或标 pre-existing 并降级）。',
    '2. 每条必须有证据：写出你实际跑的命令与关键输出。跑不了就 evidence 留空，不要编。',
    '3. 风格、命名、格式、注释、TODO、诊断类一律不报。',
    '4. 最多 ' + input.maxFindings + ' 条，按严重度排序。',
    '5. 不要修改仓库里的任何文件（临时脚本写到系统临时目录）。',
    '6. 不属于你镜头的发现写进 declined 并说明理由，不要塞进 findings。',
    '',
    '产出（唯一允许的输出方式）：把下面的 JSON 写到这个文件：' + input.outFile,
    FINDING_SCHEMA,
    '',
    'anchor 必须是缺陷所在那一行的原文（逐字），因为下游用「文件 + 归一化行」做去重指纹。',
    '写完文件后，只回复一行：DONE ' + input.lens.id + ' <findings 数量>。',
  ].join('\n')
}

export function buildIssueTriagePrompt(input: { title: string; body: string; root: string; outFile: string }): string {
  return [
    '你是 issue 分诊员。目标：判断这条 issue 属于哪类、还缺什么信息、能不能复现。',
    '',
    '仓库：' + input.root,
    '标题：' + input.title,
    '',
    '正文：',
    input.body.slice(0, 4000),
    '',
    '要求：',
    '1. 分类：bug / feature / question / docs / duplicate-suspect。',
    '2. 若是 bug：尝试复现（读代码、跑最小脚本）。成功→写最小复现步骤与证据；失败→列出还缺什么（版本、平台、日志、最小用例）。',
    '3. 给出可能相关的文件（file:line），只能来自你实际读过的代码。',
    '4. 不要空泛建议；每条都要有依据。',
    '',
    '产出：把 JSON 写到 ' + input.outFile + '：',
    '{ "kind": "bug|feature|question|docs|duplicate-suspect", "confidence": 0.0,',
    '  "reproduced": false, "repro": "命令 + 输出 或 空", "missing": ["还缺什么"],',
    '  "suspects": [ { "file": "src/a.js", "line": 10, "why": "..." } ],',
    '  "reply": "建议回给报告者的原话" }',
  ].join('\n')
}

export function buildEvalPrompt(input: { root: string; sha: string; note: string; outFile: string }): string {
  return [
    '你是审阅者评测的执行员。下面这个 commit 当年引起过真实缺陷：',
    'commit: ' + input.sha + '  说明：' + input.note,
    '仓库：' + input.root,
    '',
    '任务：把这个 commit 当作一次待审改动（git show ' + input.sha + '），用平时标准审一遍，',
    '判断你能否独立发现当年那个问题。不要查看后续修复 commit 的 diff。',
    '',
    '产出：把 JSON 写到 ' + input.outFile + '：',
    '{ "found": false, "file": "...", "line": 0, "message": "...", "evidence": "命令 + 输出" }',
  ].join('\n')
}
