import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appPort = Number(process.env.SMOKE_APP_PORT || 4175)
const chromePort = Number(process.env.SMOKE_CHROME_PORT || (9300 + Math.floor(Math.random() * 1000)))
const appUrl = process.env.SMOKE_URL || `http://127.0.0.1:${appPort}/`
const requireChrome = process.env.SMOKE_REQUIRE_CHROME === '1'

let appProcess = null
let chromeProcess = null
let chromeProfile = ''
let stopping = false

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log(message) {
  console.log(`[smoke] ${message}`)
}

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  for (const binary of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [binary], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      // Continue through the usual binary names.
    }
  }
  return ''
}

async function waitForFetch(url, label, timeoutMs = 15000) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`${response.status} ${response.statusText}`)
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || 'timeout'}`)
}

async function waitForJson(url, label, timeoutMs = 15000) {
  const response = await waitForFetch(url, label, timeoutMs)
  return response.json()
}

async function startAppServer() {
  if (process.env.SMOKE_URL) {
    await waitForFetch(appUrl, 'configured app URL')
    return
  }
  const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')
  appProcess = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSER: 'none',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', (chunk) => {
    if (process.env.SMOKE_VERBOSE) process.stdout.write(chunk)
  })
  appProcess.stderr.on('data', (chunk) => {
    if (process.env.SMOKE_VERBOSE) process.stderr.write(chunk)
  })
  appProcess.on('exit', (code) => {
    if (!stopping && code) console.error(`[smoke] Vite exited with code ${code}`)
  })
  await waitForFetch(appUrl, 'Vite server')
}

async function startChrome() {
  const chrome = findChromeBinary()
  if (!chrome) {
    const message = 'Chrome/Chromium was not found; set CHROME_BIN or install Chrome to run browser smoke.'
    if (requireChrome) throw new Error(message)
    log(`${message} Skipping.`)
    return false
  }
  chromeProfile = mkdtempSync(join(tmpdir(), 'rbshift-smoke-'))
  chromeProcess = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chromeProcess.stderr.on('data', (chunk) => {
    if (process.env.SMOKE_VERBOSE) process.stderr.write(chunk)
  })
  await waitForJson(`http://127.0.0.1:${chromePort}/json/version`, 'Chrome debugging endpoint')
  return true
}

class CdpClient {
  constructor(endpoint) {
    this.endpoint = endpoint
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
    this.ws = null
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.endpoint)
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
      this.ws.addEventListener('message', (event) => this.handleMessage(event))
    })
  }

  handleMessage(event) {
    const message = JSON.parse(event.data)
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)))
      else resolve(message.result || {})
      return
    }
    const keys = [`${message.sessionId || ''}:${message.method}`, `*:${message.method}`]
    for (const key of keys) {
      for (const handler of this.handlers.get(key) || []) handler(message.params || {}, message.sessionId)
    }
  }

  on(method, handler, sessionId = '*') {
    const key = `${sessionId}:${method}`
    const handlers = this.handlers.get(key) || []
    handlers.push(handler)
    this.handlers.set(key, handlers)
  }

  send(method, params = {}, sessionId = '') {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(payload))
    })
  }

  close() {
    this.ws?.close()
  }
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
  }
  return result.result?.value
}

async function assertEval(page, expression, message) {
  const ok = await evaluate(page, `Boolean(${expression})`)
  if (!ok) throw new Error(message)
}

async function waitForEval(page, expression, message, timeoutMs = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(page, `Boolean(${expression})`)) return
    await delay(150)
  }
  throw new Error(message)
}

async function clickByText(page, selector, text) {
  const clicked = await evaluate(page, `
    (() => {
      const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((el) => el.innerText.trim() === ${JSON.stringify(text)});
      if (!target) return false;
      target.click();
      return true;
    })()
  `)
  if (!clicked) throw new Error(`Could not click ${selector} with text "${text}"`)
}

function appUrlWithParam(key, value) {
  const url = new URL(appUrl)
  url.searchParams.set(key, value)
  return url.toString()
}

async function runBrowserChecks() {
  const version = await waitForJson(`http://127.0.0.1:${chromePort}/json/version`, 'Chrome debugging endpoint')
  const browser = new CdpClient(version.webSocketDebuggerUrl)
  await browser.connect()
  const consoleProblems = []
  browser.on('Runtime.exceptionThrown', (params) => {
    consoleProblems.push(params.exceptionDetails?.text || 'Runtime exception')
  })
  browser.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') consoleProblems.push(params.entry.text)
  })
  browser.on('Runtime.consoleAPICalled', (params) => {
    if (['error', 'assert'].includes(params.type)) {
      consoleProblems.push(params.args?.map((arg) => arg.value || arg.description).filter(Boolean).join(' ') || params.type)
    }
  })

  const target = await browser.send('Target.createTarget', { url: 'about:blank' })
  const attached = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const sessionId = attached.sessionId
  const page = {
    send: (method, params = {}) => browser.send(method, params, sessionId),
  }
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Log.enable')
  await page.send('Page.navigate', { url: appUrl })
  await waitForEval(page, 'document.readyState === "complete" || document.readyState === "interactive"', 'Page did not load')
  await waitForEval(page, 'document.body && document.body.innerText.includes("Plán směn")', 'Planner screen did not render')
  await assertEval(page, 'document.title.includes("RBSHIFT")', 'Document title is missing RBSHIFT')
  await assertEval(page, '!document.body.innerText.includes("Internal server error")', 'Vite error overlay is visible')

  await clickByText(page, '.sidebar-nav button', 'Řidiči')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Řidiči")', 'Drivers screen did not open')
  await assertEval(page, 'document.querySelectorAll(".list-row-main[role=\\"button\\"]").length > 0', 'Clickable list row target is missing')
  await assertEval(page, 'document.querySelectorAll(".list-row-actions .danger-mini").length > 0', 'Destructive row action is missing')

  await evaluate(page, 'document.querySelector(".list-row-main")?.click()')
  await waitForEval(page, 'document.body.innerText.includes("Detail řidiče")', 'Driver detail drawer did not open')
  await evaluate(page, '[...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "Zrušit")?.click()')
  await waitForEval(page, '!document.body.innerText.includes("Detail řidiče")', 'Driver detail drawer did not close')

  await evaluate(page, 'document.querySelector(".list-row-actions .danger-mini")?.click()')
  await waitForEval(page, 'document.querySelector(".action-modal")', 'Delete confirmation modal did not open')
  await assertEval(page, '!document.querySelector(".action-modal input")', 'Delete confirmation should not ask for typed text')
  await evaluate(page, '[...document.querySelectorAll(".action-modal button")].find((button) => button.innerText.trim() === "Zpět")?.click()')

  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  })
  await page.send('Page.navigate', { url: appUrl })
  await waitForEval(page, 'document.body && document.body.innerText.includes("Plán směn")', 'Mobile planner did not render')
  await assertEval(page, 'document.querySelector(".app-topbar-title")?.innerText.trim() === "Plán směn"', 'Mobile topbar title should only show the current page')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Staff mobile planner should not overflow horizontally')

  await clickByText(page, '.sidebar-nav button', 'Výčetky')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Výčetky")', 'Mobile settlements screen did not open')
  await assertEval(page, 'getComputedStyle(document.querySelector(".settlement-mobile-list")).display !== "none"', 'Mobile settlements list should replace the desktop table')
  await assertEval(page, 'getComputedStyle(document.querySelector(".settlement-table")).display === "none"', 'Desktop settlement table should be hidden on mobile')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Staff mobile settlements should not overflow horizontally')

  await clickByText(page, '.sidebar-nav button', 'Notifikace')
  await waitForEval(page, 'document.body.innerText.includes("Centrum upozornění") || document.body.innerText.includes("Zatím žádné notifikace")', 'Mobile staff notifications did not open')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Staff mobile notifications should not overflow horizontally')

  await page.send('Page.navigate', { url: appUrlWithParam('demoRole', 'driver') })
  await waitForEval(page, 'document.body && document.querySelector(".driver-bottom-nav")', 'Driver mobile shell did not render')
  await assertEval(page, 'document.body.innerText.includes("Domů") && document.body.innerText.includes("Dostupnost") && document.body.innerText.includes("Notifikace") && document.body.innerText.includes("Nastavení")', 'Driver bottom navigation labels are missing')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Driver mobile page should not overflow horizontally')
  await assertEval(page, '!/row-level security|violates row-level security/i.test(document.body.innerText)', 'Driver UI leaked a technical RLS error')

  await clickByText(page, '.driver-bottom-nav button', 'Notifikace')
  await waitForEval(page, 'document.body.innerText.includes("Doručené")', 'Driver notifications screen did not open')
  await clickByText(page, '.driver-bottom-nav button', 'Dostupnost')
  await waitForEval(page, 'document.body.innerText.includes("Nová dostupnost")', 'Driver availability screen did not open')
  await clickByText(page, '.driver-bottom-nav button', 'Nastavení')
  await waitForEval(page, 'document.body.innerText.includes("Upozornění na směny")', 'Driver settings screen did not open')

  browser.close()
  if (consoleProblems.length) {
    throw new Error(`Browser console reported problems:\n${[...new Set(consoleProblems)].join('\n')}`)
  }
}

async function cleanup() {
  stopping = true
  if (chromeProcess && !chromeProcess.killed) chromeProcess.kill()
  if (appProcess && !appProcess.killed) appProcess.kill()
  if (chromeProfile) rmSync(chromeProfile, { recursive: true, force: true })
}

try {
  await startAppServer()
  log(`app ready at ${appUrl}`)
  const chromeReady = await startChrome()
  if (chromeReady) {
    await runBrowserChecks()
    log('browser smoke passed')
  }
} finally {
  await cleanup()
}
