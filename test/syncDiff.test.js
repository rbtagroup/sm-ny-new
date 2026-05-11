import test from 'node:test'
import assert from 'node:assert/strict'
import { addedRows, changedRows, stableFingerprint } from '../src/lib/syncDiff.js'

test('stableFingerprint ignores object key ordering', () => {
  assert.equal(
    stableFingerprint({ id: 'row_1', nested: { b: 2, a: 1 } }),
    stableFingerprint({ nested: { a: 1, b: 2 }, id: 'row_1' }),
  )
})

test('changedRows returns only added or meaningfully changed rows', () => {
  const previous = [
    { id: 'a', title: 'same', meta: { b: 2, a: 1 } },
    { id: 'b', title: 'old' },
  ]
  const next = [
    { meta: { a: 1, b: 2 }, title: 'same', id: 'a' },
    { id: 'b', title: 'new' },
    { id: 'c', title: 'created' },
  ]

  assert.deepEqual(changedRows(previous, next).map((row) => row.id), ['b', 'c'])
})

test('addedRows ignores changed existing rows', () => {
  assert.deepEqual(
    addedRows([{ id: 'a', title: 'old' }], [{ id: 'a', title: 'new' }, { id: 'b', title: 'created' }]).map((row) => row.id),
    ['b'],
  )
})
