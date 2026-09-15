import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreRecords, takeBackChange } from '../src/lib/undo.js'

test('restoreRecords puts changed and removed records back and drops the added ones', () => {
  const data = {
    shifts: [{ id: 'sh_new' }, { id: 'sh_1', status: 'confirmed' }, { id: 'sh_2', status: 'assigned', note: 'changed meanwhile' }],
  }
  const restored = restoreRecords(data, 'shifts', [{ id: 'sh_1', status: 'assigned' }, { id: 'sh_gone', status: 'draft' }], ['sh_new'])

  assert.deepEqual(restored.shifts, [
    { id: 'sh_gone', status: 'draft' },
    { id: 'sh_1', status: 'assigned' },
    { id: 'sh_2', status: 'assigned', note: 'changed meanwhile' },
  ])
})

test('takeBackChange undoes a status change together with the notice it sent', () => {
  const before = { id: 'sh_1', status: 'assigned' }
  const data = {
    shifts: [{ ...before, status: 'confirmed' }],
    notifications: [{ id: 'ntf_new', title: 'Stav směny: Potvrzeno' }, { id: 'ntf_old' }],
  }
  const restored = takeBackChange(data, [{ key: 'shifts', before: [before] }, { key: 'notifications', addedIds: ['ntf_new'] }])

  assert.deepEqual(restored.shifts, [before])
  assert.deepEqual(restored.notifications, [{ id: 'ntf_old' }])
})
