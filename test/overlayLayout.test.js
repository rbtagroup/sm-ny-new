import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/main.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Declaration blocks of every rule whose selector list contains `selector`, in source order (media rules included).
function blocksFor(selector) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(',').map((item) => item.trim()).includes(selector))
    .map((match) => match[2])
}

function declaration(block, property) {
  const match = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))
  return match ? match[1].trim() : null
}

function zIndex(selector) {
  const values = blocksFor(selector).map((block) => declaration(block, 'z-index')).filter(Boolean)
  assert.ok(values.length, `${selector} should set z-index`)
  return Number(values.at(-1))
}

test('side drawer header is not sticky and only the drawer body scrolls', () => {
  const heads = blocksFor('.shift-drawer-head')
  assert.ok(heads.length, '.shift-drawer-head rules should exist')
  for (const block of heads) assert.notEqual(declaration(block, 'position'), 'sticky', 'Safari pushes a sticky drawer header over the form')
  assert.ok(blocksFor('.shift-drawer').some((block) => declaration(block, 'overflow') === 'hidden'))
  const body = blocksFor('.shift-drawer-body').find((block) => declaration(block, 'overflow') === 'auto')
  assert.ok(body, '.shift-drawer-body should scroll')
  assert.equal(declaration(body, 'min-height'), '0')
})

test('modals open above side drawers and notices stay on top', () => {
  assert.ok(zIndex('.modal-backdrop') > zIndex('.shift-drawer-backdrop'), 'confirmations opened from a drawer must not render behind it')
  assert.ok(zIndex('.app-notice') > zIndex('.modal-backdrop'))
})

test('settlement modal sticky header offsets the negative margin it uses to reach the card edge', () => {
  const blocks = blocksFor('.settlement-modal .section-title').filter((block) => declaration(block, 'margin'))
  assert.ok(blocks.length >= 2)
  for (const block of blocks) {
    assert.equal(declaration(block, 'top'), declaration(block, 'margin').split(/\s+/)[0], 'top must equal the negative top margin, otherwise content shows above the header')
  }
})

test('mobile page card restyle leaves modal cards opaque', () => {
  assert.equal(blocksFor('.app-with-topbar .card').length, 0, 'use .app-with-topbar .card:not(:where(.modal-card)) so modal cards keep their background')
  assert.equal(blocksFor('.app-with-topbar .card:not(:where(.modal-card))').length, 1)
})
