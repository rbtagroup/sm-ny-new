// Compares computed styles of the whole UI between two versions of the stylesheet.
// Both versions are applied to the same live DOM (demo data) one after another, so any difference
// in any element, pseudo-element, hover/focus state, open <details> or viewport width is reported.
//
//   node scripts/style-diff.mjs                 # git HEAD styles vs working tree
//   BASE_REF=abc123 node scripts/style-diff.mjs # another baseline commit
//   QUICK=1 node scripts/style-diff.mjs         # fewer widths and no hover/focus pass
//   CONCURRENCY=2 node scripts/style-diff.mjs   # viewports checked in parallel (default 4)
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize } from 'node:path'

const root = process.cwd()
const baseRef = process.env.BASE_REF || 'HEAD'
const quick = process.env.QUICK === '1'
const concurrency = Math.max(1, Number(process.env.CONCURRENCY) || 4)
const onlyStates = process.env.STATES ? new Set(process.env.STATES.split(',')) : null
const reportPath = process.env.OUT || join(tmpdir(), 'rbshift-style-diff.json')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Stylesheet entry is src/main.css; relative @import lines are inlined in order.
function bundle(readFile, path = 'src/main.css', seen = new Set()) {
  if (seen.has(path)) throw new Error(`Circular @import: ${path}`)
  seen.add(path)
  return readFile(path).replace(/^@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;\s*$/gm, (_, target) => bundle(readFile, normalize(join(dirname(path), target)), seen))
}
const baseCss = bundle((path) => execFileSync('git', ['show', `${baseRef}:${path}`], { encoding: 'utf8', maxBuffer: 20e6 }))
const candidateCss = bundle((path) => readFileSync(join(root, path), 'utf8'))
const customProperties = [...new Set([...`${baseCss}\n${candidateCss}`.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]))]

const widths = quick ? [390, 820, 1470] : [320, 400, 540, 600, 700, 820, 950, 1100, 1300, 1470]
const viewports = [
  ...widths.map((width) => ({ name: `w${width}`, width, height: 900, mobile: width <= 760 })),
  ...(quick ? [] : [{ name: 'iphone-safe-area', width: 402, height: 874, mobile: true, insets: { top: 62, bottom: 34, left: 0, right: 0 } }]),
]

const click = (selector, text) => `(() => { const want = ${JSON.stringify(text)}; const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => (item.innerText || item.getAttribute('aria-label') || '').trim() === want && item.getClientRects().length) || [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => (item.innerText || '').trim() === want); el?.click(); return Boolean(el) })()`
const openDetailMenu = `(() => { document.querySelectorAll('.shift-detail-more, .row-more, .staff-shift-more-actions').forEach((item) => { item.open = true }); return true })()`
const clickIfPresent = (selector, text) => `(() => { [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => (item.innerText || '').trim() === ${JSON.stringify(text)} && item.getClientRects().length)?.click(); return true })()`
const clickFirst = (selector) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.getClientRects().length) || document.querySelector(${JSON.stringify(selector)}); el?.click(); return Boolean(el) })()`
const staffNav = (label) => click('.sidebar-nav button', label)
const plannerMenu = (label) => [`(() => { const menu = document.querySelector('.planner-more-actions'); if (menu) menu.open = true; return Boolean(menu) })()`, click('.planner-more-panel button', label)]
const driverNav = (label) => `(() => { const el = [...document.querySelectorAll('.driver-bottom-nav button')].find((item) => item.querySelector('b')?.textContent.trim() === ${JSON.stringify(label)}); el?.click(); return Boolean(el) })()`
const typeInto = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`

const states = [
  ['auth', 'login', []],
  ['auth', 'signup', [click('button', 'Vytvořit účet')]],
  ['staff', 'planner', [staffNav('Plán směn')]],
  ['staff', 'planner-new-shift', [staffNav('Plán směn'), click('button', '+ Nová směna')]],
  ['staff', 'planner-detail', [staffNav('Plán směn'), clickFirst('.calendar-shift-card')]],
  ['staff', 'planner-table', [staffNav('Plán směn'), clickFirst('.planner-kpi-item'), openDetailMenu]],
  ['staff', 'planner-week-plan', [staffNav('Plán směn'), ...plannerMenu('Naplánovat týden')]],
  ['staff', 'planner-dirty-close', [staffNav('Plán směn'), click('button', '+ Nová směna'), typeInto('.shift-drawer textarea', 'rozepsáno'), click('.shift-drawer-head button', 'Zavřít')]],
  // the detail offers only the steps that fit the time of day: check in and out today, or mark an older shift done
  ['staff', 'planner-settlement', [staffNav('Plán směn'), clickFirst('.calendar-shift-card'), openDetailMenu, clickIfPresent('.shift-drawer button', 'Zaznamenat nástup'), openDetailMenu, clickIfPresent('.shift-drawer button', 'Zaznamenat konec'), openDetailMenu, clickIfPresent('.shift-drawer button', 'Označit jako dokončenou'), clickIfPresent('.modal-backdrop button', 'Změnit stav'), openDetailMenu, `(() => { const b = [...document.querySelectorAll('.shift-drawer button')].find((x) => ['Otevřít výčetku', 'Založit výčetku'].includes(x.innerText.trim()) && !x.disabled); b?.click(); return Boolean(b) })()`]],
  ['staff', 'planner-decline', [staffNav('Plán směn'), clickFirst('.calendar-shift-card'), openDetailMenu, click('.shift-drawer button', 'Odmítnout směnu')]],
  ['staff', 'planner-detail-menu', [staffNav('Plán směn'), clickFirst('.calendar-shift-card'), openDetailMenu]],
  ['staff', 'planner-cover-gap', [staffNav('Plán směn'), clickFirst('.calendar-gap')]],
  ['staff', 'dashboard', [staffNav('Dashboard')]],
  ['staff', 'audit', [staffNav('Dashboard'), click('.page-tabs button', 'Audit týdne')]],
  ['staff', 'history', [staffNav('Dashboard'), click('.page-tabs button', 'Historie změn')]],
  ['staff', 'settlements', [staffNav('Výčetky')]],
  ['staff', 'notifications', [staffNav('Plán směn'), click('button', '+ Nová směna'), `(() => { document.querySelector('.shift-drawer input[type="checkbox"]')?.click(); return true })()`, click('.shift-drawer button', 'Uložit'), staffNav('Notifikace')]],
  ['staff', 'drivers', [staffNav('Řidiči')]],
  ['staff', 'drivers-edit', [staffNav('Řidiči'), clickFirst('.list-row-main')]],
  ['staff', 'drivers-create', [staffNav('Řidiči'), click('button', '+ Přidat řidiče')]],
  ['staff', 'drivers-remove', [staffNav('Řidiči'), clickFirst('.list-row-main'), click('.shift-drawer button', 'Smazat řidiče trvale')]],
  ['staff', 'drivers-deactivate', [staffNav('Řidiči'), clickFirst('.list-row-main'), click('.shift-drawer button', 'Deaktivovat řidiče')]],
  ['staff', 'vehicles', [staffNav('Vozidla')]],
  ['staff', 'vehicles-edit', [staffNav('Vozidla'), clickFirst('.list-row-main')]],
  ['staff', 'availability', [staffNav('Řidiči'), click('button', 'Dostupnost a nepřítomnost')]],
  ['staff', 'templates', [staffNav('Plán směn'), ...plannerMenu('Šablony směn')]],
  ['staff', 'templates-create', [staffNav('Plán směn'), ...plannerMenu('Šablony směn'), click('button', '+ Přidat šablonu')]],
  ['staff', 'planner-more-menu', [staffNav('Plán směn'), `(() => { const menu = document.querySelector('.planner-more-actions'); if (menu) menu.open = true; return Boolean(menu) })()`]],
  ['staff', 'planner-day-need', [staffNav('Plán směn'), `(() => { const menu = document.querySelector('.day.today .day-menu'); if (menu) menu.open = true; return Boolean(menu) })()`, click('.day-menu-panel button', 'Potřeba řidičů')]],
  ['staff', 'coverage-norms', [staffNav('Plán směn'), ...plannerMenu('Normy pokrytí')]],
  ['staff', 'coverage-norms-edit', [staffNav('Plán směn'), ...plannerMenu('Normy pokrytí'), clickFirst('.list-row-main')]],
  ['staff', 'settings', [staffNav('Nastavení')]],
  ['staff', 'user-menu', [staffNav('Plán směn'), clickFirst('.topbar-user-button')]],
  ['staff', 'bell-menu', [staffNav('Plán směn'), clickFirst('.topbar-icon-button')]],
  ['driver', 'home', [driverNav('Domů')]],
  ['driver', 'home-calendar', [driverNav('Domů'), click('button', 'Zobrazit')]],
  ['driver', 'availability', [driverNav('Dostupnost')]],
  ['driver', 'notifications', [driverNav('Notifikace')]],
  ['driver', 'settings', [driverNav('Nastavení')]],
].filter(([role, name]) => !onlyStates || onlyStates.has(`${role}:${name}`))

const capture = `(() => {
  const props = window.__styleDiffProps || (window.__styleDiffProps = [...Array.from(getComputedStyle(document.documentElement)).filter((prop) => !/^(transition|animation)/.test(prop)), ...${JSON.stringify(customProperties)}])
  const read = (style) => props.map((prop) => style.getPropertyValue(prop))
  return [document.documentElement, ...document.querySelectorAll('body, body *')].map((el) => {
    const row = read(getComputedStyle(el))
    for (const pseudo of ['::before', '::after']) {
      const style = getComputedStyle(el, pseudo)
      row.push(style.content === 'none' ? '' : read(style).join('|'))
    }
    row.push(el.matches('input, textarea') ? read(getComputedStyle(el, '::placeholder')).join('|') : '')
    const box = el.getBoundingClientRect()
    row.push([box.x, box.y, box.width, box.height].map((value) => Math.round(value * 2) / 2).join(','))
    return row
  })
})()`

const compare = `((before, after) => {
  const props = window.__styleDiffProps
  const names = [...props, '::before', '::after', '::placeholder', 'box']
  const elements = [document.documentElement, ...document.querySelectorAll('body, body *')]
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '') + ((el.innerText || '').trim() ? ' "' + (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 30) + '"' : '')
  const diffs = []
  if (before.length !== after.length) return [{ element: 'document', changes: ['element count ' + before.length + ' → ' + after.length] }]
  before.forEach((row, index) => {
    const other = after[index]
    const changes = []
    row.forEach((value, column) => { if (value !== other[column] && changes.length < 6) changes.push(names[Math.min(column, names.length - 1)] + ': ' + String(value).slice(0, 80) + ' → ' + String(other[column]).slice(0, 80)) })
    if (changes.length) diffs.push({ element: describe(elements[index]), changes })
  })
  return diffs
})(window.__styleBefore, window.__styleAfter)`

const children = []
const serverEnv = (supabaseUrl) => ({ ...process.env, BROWSER: 'none', VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_ANON_KEY: supabaseUrl ? 'style-diff-dummy-key' : '' })
async function startServer(port, supabaseUrl) {
  children.push(spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, env: serverEnv(supabaseUrl), stdio: 'ignore' }))
  for (let attempt = 0; attempt < 160; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return } catch {}
    await delay(250)
  }
  throw new Error(`Vite on ${port} did not start`)
}

class Cdp {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map() }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)
      this.ws.onopen = resolve
      this.ws.onerror = reject
      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (!message.id || !this.pending.has(message.id)) return
        const { resolve: done, reject: fail } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) fail(new Error(message.error.message)); else done(message.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params, sessionId }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
}

const report = { baseRef, quick, widths: viewports.map((vp) => vp.name), states: states.length, checks: 0, setupFailures: [], differences: [] }
try {
  const demoPort = 4300 + Math.floor(Math.random() * 100)
  const authPort = demoPort + 100
  await Promise.all([startServer(demoPort, ''), startServer(authPort, 'https://style-diff.invalid')])
  const chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path))
  if (!chromePath) throw new Error('Chrome not found')
  const chromePort = 9400 + Math.floor(Math.random() * 400)
  const profile = mkdtempSync(join(tmpdir(), 'rbshift-style-diff-'))
  // background targets must not be throttled: every viewport runs in its own tab at the same time
  children.push(spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' }))
  let version
  for (let attempt = 0; attempt < 80 && !version; attempt++) { try { version = await (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).json() } catch { await delay(250) } }
  const cdp = new Cdp(version.webSocketDebuggerUrl)
  await cdp.connect()

  const runViewport = async (vp) => {
    // a separate browser context gets its own renderer process, so viewports really run in parallel
    const { browserContextId } = await cdp.send('Target.createBrowserContext')
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const page = (method, params) => cdp.send(method, params, sessionId)
    const evaluate = async (expression) => {
      const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      return result.result?.value
    }
    await page('Page.enable'); await page('Runtime.enable'); await page('DOM.enable'); await page('CSS.enable')
    await page('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile })
    await page('Emulation.setTouchEmulationEnabled', vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
    if (vp.insets) await page('Emulation.setSafeAreaInsetsOverride', { insets: vp.insets })

    const applyCss = async (css) => {
      await evaluate(`(() => { const style = [...document.querySelectorAll('style[data-vite-dev-id]')].find((item) => item.dataset.viteDevId.endsWith('/src/main.css')); if (!style) throw new Error('main.css style element not found'); style.textContent = ${JSON.stringify(css)}; return document.body.offsetHeight })()`)
      await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    }
    const checkVariant = async (label) => {
      await applyCss(baseCss)
      await evaluate(`window.__styleBefore = ${capture}; true`)
      await applyCss(candidateCss)
      await evaluate(`window.__styleAfter = ${capture}; true`)
      const diffs = await evaluate(compare)
      await evaluate('window.__styleBefore = window.__styleAfter = null; true')
      report.checks += 1
      return diffs.map((diff) => ({ variant: label, ...diff }))
    }
    const forceStates = async (selector, pseudoClasses) => {
      const { root: documentNode } = await page('DOM.getDocument', { depth: -1 })
      const { nodeIds } = await page('DOM.querySelectorAll', { nodeId: documentNode.nodeId, selector })
      for (const nodeId of nodeIds.slice(0, 250)) await page('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudoClasses })
      return nodeIds.slice(0, 250)
    }

    const runState = async (role, name, steps) => {
      const port = role === 'auth' ? authPort : demoPort
      const setupFailures = []
      // every state starts from fresh demo data; earlier scenarios check in, finish or decline shifts
      await page('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${port}`, storageTypes: 'local_storage,session_storage,indexeddb' }).catch(() => {})
      // a blank page first, so the same URL twice in a row cannot leave the old page looking ready while it reloads
      await page('Page.navigate', { url: 'about:blank' })
      await page('Page.navigate', { url: `http://127.0.0.1:${port}/${role === 'auth' ? '' : `?demoRole=${role === 'staff' ? 'admin' : 'driver'}`}` })
      const ready = role === 'auth' ? '.auth-card' : role === 'staff' ? '.sidebar-nav button' : '.driver-bottom-nav button'
      const readyCheck = `Boolean(document.querySelector(${JSON.stringify(ready)})) && [...document.querySelectorAll('style[data-vite-dev-id]')].some((item) => item.dataset.viteDevId.endsWith('/src/main.css'))`
      for (let attempt = 0; attempt < 120 && !(await evaluate(readyCheck).catch(() => false)); attempt++) await delay(100)
      await delay(400)
      await evaluate(`(() => { const style = document.createElement('style'); style.id = 'style-diff-freeze'; style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}'; document.head.appendChild(style); return true })()`)
      for (const step of steps) {
        const ok = await evaluate(step).catch((error) => String(error))
        if (ok !== true && ok !== undefined) setupFailures.push(`${vp.name} ${role}:${name} step ${steps.indexOf(step)} → ${ok}`)
        await delay(450)
      }
      await delay(300)
      const found = [...await checkVariant('base')]
      await evaluate(`document.querySelectorAll('details:not([open])').forEach((item) => { item.setAttribute('open', ''); item.dataset.styleDiffOpened = '1' }); true`)
      found.push(...await checkVariant('details-open'))
      await evaluate(`document.querySelectorAll('[data-style-diff-opened]').forEach((item) => { item.removeAttribute('open'); delete item.dataset.styleDiffOpened }); true`)
      if (!quick) {
        const hovered = await forceStates('button, a, summary, [role=button], .list-row, .card, .nav button, input, select, textarea, label', ['hover'])
        found.push(...await checkVariant('hover'))
        for (const nodeId of hovered) await page('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
        const focused = await forceStates('button, a, summary, input, select, textarea, [tabindex]', ['focus', 'focus-visible', 'focus-within'])
        found.push(...await checkVariant('focus'))
        for (const nodeId of focused) await page('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
      }
      report.setupFailures.push(...setupFailures)
      const unique = new Map(found.map((diff) => [`${diff.variant}|${diff.element}|${diff.changes.join(';')}`, diff]))
      if (unique.size) report.differences.push({ viewport: vp.name, state: `${role}:${name}`, count: unique.size, sample: [...unique.values()].slice(0, 25) })
      process.stdout.write(`${unique.size ? '✖' : '·'} ${vp.name} ${role}:${name}${unique.size ? ` (${unique.size})` : ''}\n`)
    }
    for (const [role, name, steps] of states) {
      // Vite can reload the page on its own (e.g. after optimizing dependencies); such a state is simply run again
      for (let attempt = 1; ; attempt++) {
        try {
          await runState(role, name, steps)
          break
        } catch (error) {
          if (attempt >= 3 || !String(error?.message).includes('main.css style element not found')) throw error
          process.stdout.write(`↻ ${vp.name} ${role}:${name} page reloaded, running the state again\n`)
        }
      }
    }
    await cdp.send('Target.closeTarget', { targetId })
    await cdp.send('Target.disposeBrowserContext', { browserContextId })
  }
  const pending = [...viewports]
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => { while (pending.length) await runViewport(pending.shift()) }))
} finally {
  for (const child of children) { try { child.kill() } catch {} }
  await delay(300)
}

writeFileSync(reportPath, JSON.stringify(report, null, 2))
const total = report.differences.reduce((sum, item) => sum + item.count, 0)
console.log(`\n${report.checks} style checks across ${report.widths.length} viewports and ${report.states} states; ${total} differing elements; ${report.setupFailures.length} setup warnings.`)
console.log(`Report: ${reportPath}`)
process.exit(total ? 1 : 0)
