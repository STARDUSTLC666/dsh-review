import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDiff, contextAround } from '../lib/diff.js'

const sample = [
  'diff --git a/src/a.js b/src/a.js',
  'index 111..222 100644',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,3 +1,4 @@',
  ' const x = 1',
  '-const y = 2',
  '+const y = 20',
  '+const z = 3',
  ' return x',
  'diff --git a/new.md b/new.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.md',
  '@@ -0,0 +1,2 @@',
  '+# hello',
  '+world',
].join('\n')

test('解析出文件、状态与行号', () => {
  const parsed = parseDiff(sample)
  assert.equal(parsed.files.length, 2)
  const a = parsed.files[0]
  assert.equal(a.path, 'src/a.js')
  assert.equal(a.status, 'modified')
  assert.equal(a.added, 2)
  assert.equal(a.removed, 1)
  const newFile = parsed.files[1]
  assert.equal(newFile.status, 'added')
  assert.equal(newFile.added, 2)
})

test('新增行拿到正确的新行号，删除行没有新行号', () => {
  const file = parseDiff(sample).files[0]
  const added = file.hunks[0].lines.filter(l => l.type === 'add')
  assert.deepEqual(added.map(l => l.newNo), [2, 3])
  const removed = file.hunks[0].lines.filter(l => l.type === 'del')
  assert.deepEqual(removed.map(l => l.oldNo), [2])
  assert.equal(removed[0].newNo, null)
})

test('上下文能按行号取回', () => {
  const file = parseDiff(sample).files[0]
  const around = contextAround(file, 3, 1)
  assert.ok(around.length >= 2)
  assert.ok(around.some(l => l.newNo === 3))
})

test('二进制与重命名被识别', () => {
  const raw = ['diff --git a/x.bin b/x.bin', 'Binary files a/x.bin and b/x.bin differ'].join('\n')
  const parsed = parseDiff(raw)
  assert.equal(parsed.files[0].binary, true)
  const renamed = ['diff --git a/old.js b/new.js', 'rename from old.js', 'rename to new.js'].join('\n')
  assert.equal(parseDiff(renamed).files[0].status, 'renamed')
})
