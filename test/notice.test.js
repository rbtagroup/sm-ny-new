import test from 'node:test'
import assert from 'node:assert/strict'
import { NOTICE_EVENT, showNotice } from '../src/lib/notice.js'

test('showNotice dispatches an in-app notice instead of a blocking alert', () => {
  const received = []
  const target = new EventTarget()
  const original = globalThis.window
  globalThis.window = target
  target.addEventListener(NOTICE_EVENT, (event) => received.push(event.detail))
  try {
    showNotice('Vyplň jméno řidiče.')
    showNotice('Text je zkopírovaný.', { tone: 'good' })
    showNotice('')
  } finally {
    if (original === undefined) delete globalThis.window
    else globalThis.window = original
  }

  assert.deepEqual(received.map(({ message, tone }) => [message, tone]), [['Vyplň jméno řidiče.', 'warn'], ['Text je zkopírovaný.', 'good']])
})

test('showNotice carries an undo action only when it is a function', () => {
  const received = []
  const target = new EventTarget()
  const original = globalThis.window
  globalThis.window = target
  target.addEventListener(NOTICE_EVENT, (event) => received.push(event.detail))
  const undo = () => {}
  try {
    showNotice('Řidič je vyřazený.', { tone: 'good', undo })
    showNotice('Uloženo.', { tone: 'good', undo: 'not a function' })
  } finally {
    if (original === undefined) delete globalThis.window
    else globalThis.window = original
  }

  assert.equal(received[0].undo, undo)
  assert.equal(received[1].undo, null)
})
