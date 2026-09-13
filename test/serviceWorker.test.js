import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('service worker recognises Vite 8 hashed asset names for cache-first loading', () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  const match = source.match(/const isHashedAsset = \(url\) => \/(.+)\/i\.test\(url\.pathname\);/)
  assert.ok(match, 'isHashedAsset regex should exist')
  const isHashed = (pathname) => new RegExp(match[1], 'i').test(pathname)

  assert.equal(isHashed('/assets/index-DQU65_cD.js'), true)
  assert.equal(isHashed('/assets/react-vendor-DaSoaILB.js'), true)
  assert.equal(isHashed('/assets/index-DhTEGqpH.css'), true)
  assert.equal(isHashed('/manifest.webmanifest'), false)
  assert.equal(isHashed('/icons/icon-192.png'), false)
})
