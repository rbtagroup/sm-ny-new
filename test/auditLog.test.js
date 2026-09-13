import test from 'node:test'
import assert from 'node:assert/strict'
import { isRoutineSchedulerLog } from '../src/lib/auditLog.js'

test('routine scheduler skips are hidden from history but real runs stay', () => {
  assert.equal(isRoutineSchedulerLog({ text: 'Scheduler daily-coverage skipped outside Prague window.' }), true)
  assert.equal(isRoutineSchedulerLog({ action: 'Scheduler daily-coverage skipped outside Prague window.' }), true)
  assert.equal(isRoutineSchedulerLog({ text: 'Scheduler daily-coverage: 35 chybějících kontrol (2026-09-10–2026-09-16).' }), false)
  assert.equal(isRoutineSchedulerLog({ text: 'Řidič upraven.' }), false)
  assert.equal(isRoutineSchedulerLog(null), false)
})
