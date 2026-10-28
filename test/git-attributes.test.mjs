import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { repo } from './helpers.mjs'
import { captureTarget } from '../lib/target.js'

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
function owned(t) {
  const r = repo()
  t.after(() => { assert.ok(path.basename(r.root).startsWith('dsh-review-')); fs.rmSync(r.root, { recursive: true, force: true }) })
  return r
}

for (const location of ['worktree', 'global', 'info']) {
  test('Git clean 过滤器不能隐藏变更或由审查触发：' + location, async t => {
    const r = owned(t), marker = path.join(r.root, '.git', 'filter-ran'), cleaner = path.join(r.root, '.git', 'cleaner.cjs')
    fs.writeFileSync(cleaner, 'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ',"ran");process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("const keep = 42\\nexport const value = 1\\n"));')
    r.git('config', 'filter.hide.clean', quote(process.execPath.replaceAll('\\', '/')) + ' ' + quote(cleaner.replaceAll('\\', '/')))
    const attributes = location === 'worktree' ? '.gitattributes' : location === 'info' ? '.git/info/attributes' : '.git/global-attributes'
    r.write(attributes, '*.js filter=hide\n')
    if (location === 'global') r.git('config', 'core.attributesFile', path.join(r.root, attributes))
    if (location === 'info') await assert.rejects(captureTarget(r.root, { includeUntracked: false }, 4e6, '@profile'), /info\/attributes.*未运行|incomplete/)
    else {
      const target = await captureTarget(r.root, { includeUntracked: false }, 4e6, '@profile')
      assert.ok(target.files.some(f => f.path === 'src/a.js' && f.after.includes('danger().name')))
      assert.match(target.patch, /danger\(\)\.name/)
    }
    assert.equal(fs.existsSync(marker), false)
    // 正向对照：普通 Git 确实执行同一个 harmless fixture，并把改动藏掉。
    assert.doesNotMatch(r.git('diff', 'HEAD', '--', 'src/a.js'), /danger\(\)\.name/)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'ran')
  })
}

test('info/attributes 的 binary 规则不能把文本改动变成空审查；注释文件仍可审查', async t => {
  const r = owned(t)
  r.write('.git/info/attributes', '*.js -diff\n')
  assert.match(r.git('diff', 'HEAD'), /Binary files/)
  await assert.rejects(captureTarget(r.root, {}, 4e6, '@profile'), /info\/attributes|incomplete/)
  r.write('.git/info/attributes', '\u00a0#*.js filter=hidden\n')
  await assert.rejects(captureTarget(r.root, {}, 4e6, '@profile'), /info\/attributes|incomplete/)
  r.write('.git/info/attributes', '# comment only\n\n')
  assert.match((await captureTarget(r.root, {}, 4e6, '@profile')).patch, /danger\(\)\.name/)
})

test('linked worktree 同样检查 common Git 目录内的 info/attributes', async t => {
  const r = owned(t), linked = path.join(r.root, '.linked-fixture')
  r.git('worktree', 'add', '--detach', linked, 'HEAD')
  try {
    fs.writeFileSync(path.join(linked, 'src/a.js'), 'export const value = danger().name\n')
    r.write('.git/info/attributes', '*.js -diff\n')
    await assert.rejects(captureTarget(linked, {}, 4e6, '@profile'), /info\/attributes|incomplete/)
  } finally { r.git('worktree', 'remove', '--force', linked) }
})

test('Git 的颜色、前后缀和行首设置不改变审查补丁格式', async t => {
  const r = owned(t)
  for (const [key, value] of Object.entries({ 'color.ui': 'always', 'diff.noprefix': 'true', 'diff.srcPrefix': 'before/', 'diff.dstPrefix': 'after/', 'diff.outputIndicatorNew': '>' })) r.git('config', key, value)
  const target = await captureTarget(r.root, { includeUntracked: false }, 4e6, '@profile')
  assert.deepEqual(target.files.map(f => f.path), ['src/a.js'])
  assert.match(target.patch, /\+export const value = danger\(\)\.name/)
})
