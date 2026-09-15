import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appPort = Number(process.env.SMOKE_APP_PORT || 4175)
const chromePort = Number(process.env.SMOKE_CHROME_PORT || (9300 + Math.floor(Math.random() * 1000)))
const appUrl = process.env.SMOKE_URL || `http://127.0.0.1:${appPort}/`
const requireChrome = process.env.SMOKE_REQUIRE_CHROME === '1'
const smokeScope = ['full', 'staff', 'driver'].includes(process.env.SMOKE_SCOPE) ? process.env.SMOKE_SCOPE : 'full'

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
        .find((el) => {
          const rendered = el.innerText.trim();
          return rendered === ${JSON.stringify(text)} || rendered.split(/\\n+/).some((line) => line.trim() === ${JSON.stringify(text)});
        });
      if (!target) return false;
      target.click();
      return true;
    })()
  `)
  if (!clicked) throw new Error(`Could not click ${selector} with text "${text}"`)
}

// secondary planner actions live in the 'Další akce' menu on every screen size
async function clickPlannerMenu(page, text) {
  await evaluate(page, 'document.querySelector(".planner-more-actions")?.setAttribute("open", "")')
  await clickByText(page, '.planner-more-panel button', text)
}

async function fillByPlaceholder(page, placeholder, value) {
  const filled = await evaluate(page, `
    (() => {
      const target = document.querySelector(${JSON.stringify(`[placeholder="${placeholder}"]`)});
      if (!target) return false;
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(target, ${JSON.stringify(value)});
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `)
  if (!filled) throw new Error(`Could not fill field with placeholder "${placeholder}"`)
}

async function selectFieldByLabel(page, label, value) {
  const selected = await evaluate(page, `
    (() => {
      const field = [...document.querySelectorAll(".field")]
        .find((item) => item.querySelector(":scope > label")?.innerText.trim() === ${JSON.stringify(label)});
      const target = field?.querySelector("select");
      if (!target) return false;
      target.value = ${JSON.stringify(value)};
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return target.value === ${JSON.stringify(value)};
    })()
  `)
  if (!selected) throw new Error(`Could not select value "${value}" in field "${label}"`)
}

function appUrlWithParam(key, value) {
  const url = new URL(appUrl)
  url.searchParams.set(key, value)
  return url.toString()
}

async function runStaffChecks(page) {
  await page.send('Page.navigate', { url: appUrl })
  await waitForEval(page, 'document.readyState === "complete" || document.readyState === "interactive"', 'Page did not load')
  await waitForEval(page, 'document.body && document.body.innerText.includes("Plán směn")', 'Planner screen did not render')
  await assertEval(page, 'document.title.includes("RBSHIFT")', 'Document title is missing RBSHIFT')
  await assertEval(page, '!document.body.innerText.includes("Internal server error")', 'Vite error overlay is visible')

  await clickByText(page, 'button', '+ Nová směna')
  await waitForEval(page, 'document.querySelector(".shift-drawer")', 'New shift drawer did not open')
  await selectFieldByLabel(page, 'Řidič', 'drv_roman')
  await selectFieldByLabel(page, 'Vozidlo', 'car_tesla_2')
  await evaluate(page, 'document.querySelector(".shift-drawer input[type=\\"checkbox\\"]")?.click()')
  await clickByText(page, '.shift-drawer button', 'Uložit')
  await waitForEval(page, 'document.body.innerText.includes("Směna vytvořena.")', 'New shift was not saved')

  await waitForEval(page, '!document.querySelector(".planner-toast")', 'Shift saved toast did not disappear', 6000)

  // quick steps in the shift detail are not asked about first; the notice after them takes the step back
  const storedShiftCount = '(JSON.parse(localStorage.getItem("rbshift-manager-data-v4") || "{}").shifts || []).length'
  const shiftsBefore = await evaluate(page, storedShiftCount)
  await evaluate(page, 'document.querySelector(".calendar-shift-card")?.click()')
  await waitForEval(page, 'document.querySelector(".shift-detail")', 'Shift detail did not open from the calendar')
  await evaluate(page, 'document.querySelector(".shift-detail-more")?.setAttribute("open", "")')
  await clickByText(page, '.shift-detail-more button', 'Duplikovat na další den')
  await waitForEval(page, `${storedShiftCount} === ${shiftsBefore} + 1 && Boolean(document.querySelector(".app-notice .app-notice-undo"))`, 'Duplicating a shift should save the copy and offer undo')
  await clickByText(page, '.app-notice button', 'Vrátit zpět')
  await waitForEval(page, `${storedShiftCount} === ${shiftsBefore}`, 'Undo should remove the duplicated shift again')
  await clickByText(page, '.shift-drawer-head button', 'Zavřít')
  await waitForEval(page, '!document.querySelector(".shift-drawer")', 'Shift detail did not close')

  await clickPlannerMenu(page, 'Naplánovat týden')
  await waitForEval(page, 'document.querySelector(".action-modal")?.innerText.includes("Zkopírovat předchozí týden")', 'Week plan dialog did not open')
  await evaluate(page, '[...document.querySelectorAll(".week-plan-weeks button")].at(-1)?.click()')
  await evaluate(page, `(() => {
    const option = [...document.querySelectorAll(".week-plan-option")].find((item) => item.innerText.includes("Zkopírovat předchozí týden"))
    const box = option?.querySelector("input")
    if (box && !box.checked) box.click()
  })()`)
  await waitForEval(page, '/Vytvoří se \\d+ směn/.test(document.querySelector(".week-plan-summary")?.innerText || "")', 'Week plan preview did not list the copied shifts')
  await assertEval(page, 'document.querySelectorAll(".week-plan-list li").length > 0', 'Week plan preview list is empty')
  await evaluate(page, '[...document.querySelectorAll(".action-modal button")].find((button) => button.innerText.trim().startsWith("Vytvořit"))?.click()')
  await waitForEval(page, '!document.querySelector(".action-modal") && document.body.innerText.includes("Naplánováno:")', 'Week plan did not create shifts')

  await clickByText(page, '.sidebar-nav button', 'Notifikace')
  await waitForEval(page, 'document.querySelector(".notifications-card h3")?.textContent.includes("K vyřízení")', 'Staff notifications did not open after creating a shift')
  await assertEval(page, `
    ![...document.querySelectorAll(".notifications-card .staff-notification-row")]
      .some((row) => !row.closest(".notification-archive") && row.textContent.includes("Nová směna"))
  `, 'A notice sent to a driver should not wait for dispatch')
  await evaluate(page, 'document.querySelector(".notification-archive[data-section=\\"sent\\"] summary")?.click()')
  await waitForEval(page, `
    [...document.querySelectorAll(".notification-archive[data-section=\\"sent\\"] .staff-notification-row")]
      .some((row) => row.innerText.includes("Nová směna"))
  `, 'New shift notification did not appear among notices sent to drivers')
  await evaluate(page, `
    (() => {
      const row = [...document.querySelectorAll(".staff-notification-row")]
        .find((item) => item.innerText.includes("Nová směna"));
      row?.querySelector('[aria-label="Skrýt notifikaci"]')?.click();
    })()
  `)
  await waitForEval(page, `
    ![...document.querySelectorAll(".staff-notification-row")]
      .some((row) => row.textContent.includes("Nová směna"))
  `, 'Hidden notification remained visible')
  await waitForEval(page, 'document.querySelector(".app-notice")?.innerText.includes("Notifikace je skrytá.") && document.querySelector(".app-notice .app-notice-undo")', 'Hiding a notification should offer undo')
  await clickByText(page, '.app-notice button', 'Vrátit zpět')
  await waitForEval(page, `
    [...document.querySelectorAll(".staff-notification-row")]
      .some((row) => row.textContent.includes("Nová směna"))
  `, 'Undo should bring the hidden notification back')

  await clickByText(page, '.sidebar-nav button', 'Řidiči')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Řidiči")', 'Drivers screen did not open')
  await assertEval(page, 'document.querySelectorAll(".list-row-main[role=\\"button\\"]").length > 0', 'Clickable list row target is missing')
  await assertEval(page, 'document.querySelectorAll(".list-row .danger, .list-row .danger-mini").length === 0', 'List rows should not carry delete buttons, those belong to the detail')

  await evaluate(page, 'document.querySelector(".list-row-main")?.click()')
  await waitForEval(page, 'document.body.innerText.includes("Detail řidiče")', 'Driver detail drawer did not open')
  await waitForEval(page, 'document.querySelector(".driver-invite")?.textContent.includes("Aplikace řidiče")', 'Driver detail should offer an app invite')
  await assertEval(page, `(() => {
    const link = [...document.querySelectorAll(".driver-invite a")].find((item) => item.innerText.includes("WhatsApp"))
    return Boolean(link) && link.href.startsWith("https://wa.me/420600000001?text=") && decodeURIComponent(link.href).includes("Vytvořit účet")
  })()`, 'WhatsApp invite link should carry the driver number and sign-up steps')
  await assertEval(page, '[...document.querySelectorAll(".driver-invite button")].some((button) => button.innerText.trim() === "Kopírovat pozvánku")', 'Invite copy button is missing')
  await evaluate(page, '[...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "Zavřít")?.click()')
  await waitForEval(page, '!document.body.innerText.includes("Detail řidiče")', 'Driver detail drawer did not close')

  await evaluate(page, '[...document.querySelectorAll(".list-row-main")].find((row) => row.innerText.includes("Petra"))?.click()')
  await waitForEval(page, '[...document.querySelectorAll(".shift-drawer button")].some((button) => button.innerText.trim() === "Vyřadit řidiče")', 'Driver detail should offer taking the driver out of service')
  await clickByText(page, '.shift-drawer button', 'Vyřadit řidiče')
  await waitForEval(page, '!document.querySelector(".shift-drawer") && [...document.querySelectorAll(".list-row")].some((row) => row.innerText.includes("Petra") && row.innerText.includes("Vyřazený"))', 'A retired driver should show as out of service')
  await waitForEval(page, 'document.querySelector(".app-notice .app-notice-undo")', 'Retiring a driver should offer undo instead of a confirmation')
  await clickByText(page, '.app-notice button', 'Vrátit zpět')
  await waitForEval(page, '![...document.querySelectorAll(".list-row")].some((row) => row.innerText.includes("Vyřazený"))', 'Undo should bring the driver back into service')

  await clickByText(page, 'button', '+ Přidat řidiče')
  await waitForEval(page, 'document.querySelector(".shift-drawer")?.innerText.includes("Vytvořit řidiče")', 'Add driver drawer did not open')
  await fillByPlaceholder(page, 'Např. Aleš Novák', 'Smoke Řidič')
  await fillByPlaceholder(page, 'volitelné', 'roman@demo.example')
  await clickByText(page, '.shift-drawer button', 'Vytvořit řidiče')
  await waitForEval(page, 'document.querySelector(".app-notice[role=\\"alert\\"]")?.innerText.includes("E-mail už používá řidič")', 'Duplicate e-mail should show an in-app notice instead of a blocking alert')
  await clickByText(page, '.shift-drawer button', 'Zavřít')
  await waitForEval(page, '!document.querySelector(".shift-drawer")', 'Add driver drawer did not close')

  await evaluate(page, '[...document.querySelectorAll(".list-row-main")].find((row) => row.innerText.includes("Milan"))?.click()')
  await waitForEval(page, 'document.querySelector(".shift-drawer")?.innerText.includes("Trvale odstranit řidiče")', 'Driver detail should offer permanent deletion to admins')
  await clickByText(page, '.shift-drawer button', 'Trvale odstranit řidiče')
  await waitForEval(page, 'document.querySelector(".action-modal")?.innerText.includes("Odstraní se:")', 'Permanent deletion should summarise the removed history')
  await assertEval(page, '[...document.querySelectorAll(".action-modal button")].find((button) => button.innerText.trim() === "Trvale odstranit")?.disabled === true', 'Permanent deletion must wait for the typed confirmation')
  await evaluate(page, `(() => {
    const input = document.querySelector(".action-modal input")
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "milan")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })()`)
  await waitForEval(page, '[...document.querySelectorAll(".action-modal button")].find((button) => button.innerText.trim() === "Trvale odstranit")?.disabled === false', 'Typing the driver name should enable permanent deletion')
  await clickByText(page, '.action-modal button', 'Trvale odstranit')
  await waitForEval(page, '!document.querySelector(".action-modal") && !document.querySelector(".shift-drawer")', 'Permanent deletion should close the dialog and drawer')
  await assertEval(page, '![...document.querySelectorAll(".list-row-main")].some((row) => row.innerText.includes("Milan"))', 'Deleted driver should disappear from the list')

  await assertEval(page, 'document.querySelectorAll(".sidebar-nav button").length === 7', 'Admin menu should keep seven daily items')
  await clickByText(page, 'button', 'Dostupnost a nepřítomnost')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Dostupnost řidičů")', 'Availability should open from the drivers page')
  await assertEval(page, 'document.querySelector(".sidebar-nav button.active")?.innerText.trim() === "Řidiči"', 'Availability should keep the drivers menu item highlighted')
  await assertEval(page, 'document.querySelectorAll(".availability-grid-row").length > 1', 'Availability should show the week grid of drivers and days')
  await evaluate(page, 'document.querySelector(".availability-cell .availability-add")?.click()')
  await waitForEval(page, 'document.querySelector(".shift-drawer .availability-form")', 'The + in a grid cell should open the new entry panel')
  await clickByText(page, '.availability-choice button', 'Nepřítomnost')
  await clickByText(page, '.availability-choice button', 'Dovolená')
  await clickByText(page, '.shift-drawer button', 'Uložit záznam')
  await waitForEval(page, '!document.querySelector(".shift-drawer") && [...document.querySelectorAll(".availability-grid .availability-chip")].some((chip) => chip.innerText.includes("Dovolená"))', 'A new absence should show in the grid')
  await evaluate(page, '[...document.querySelectorAll(".availability-grid .availability-chip")].find((chip) => chip.innerText.includes("Dovolená"))?.click()')
  await waitForEval(page, '[...document.querySelectorAll(".shift-drawer button")].some((button) => button.innerText.trim() === "Odstranit záznam")', 'An availability entry should open its detail')
  await clickByText(page, '.shift-drawer button', 'Odstranit záznam')
  await waitForEval(page, '!document.querySelector(".shift-drawer") && ![...document.querySelectorAll(".availability-grid .availability-chip")].some((chip) => chip.innerText.includes("Dovolená"))', 'Removing an entry should take it out of the grid right away')
  await clickByText(page, '.app-notice button', 'Vrátit zpět')
  await waitForEval(page, '[...document.querySelectorAll(".availability-grid .availability-chip")].some((chip) => chip.innerText.includes("Dovolená"))', 'Undo should put the removed entry back')

  await clickByText(page, '.sidebar-nav button', 'Plán směn')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Plán směn")', 'Planner did not reopen')
  await clickPlannerMenu(page, 'Šablony směn')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Šablony směn")', 'Shift templates should open from the planner')
  await assertEval(page, 'document.querySelector(".sidebar-nav button.active")?.innerText.trim() === "Plán směn"', 'Templates should keep the planner menu item highlighted')

  // a need set for one day shows in the calendar and is filled with a driver and open shifts at once
  await clickByText(page, '.sidebar-nav button', 'Plán směn')
  await waitForEval(page, '[...document.querySelectorAll(".calendar-gap")].some((card) => card.innerText.includes("z 3"))', 'The demo need of three drivers should show in the calendar')
  await evaluate(page, '[...document.querySelectorAll(".calendar-gap")].find((card) => card.innerText.includes("z 3"))?.click()')
  await waitForEval(page, 'document.querySelector(".cover-fill-status")?.innerText.includes("0 z 3")', 'Cover panel should show the need of the day')
  await evaluate(page, 'document.querySelector(".cover-driver-list input")?.click()')
  await clickByText(page, '.cover-fill button', 'Vypsat zbývající jako volné (2)')
  await evaluate(page, '[...document.querySelectorAll(".cover-fill label")].find((label) => label.innerText.includes("Uložit i přes problém"))?.querySelector("input")?.click()')
  await clickByText(page, '.cover-fill button', 'Vytvořit 1 směnu a 2 volné')
  await waitForEval(page, 'document.body.innerText.includes("Vytvořeno: 1 směna pro řidiče a 2 volné směny.")', 'Filling the slot did not create the shifts')
  await waitForEval(page, '[...document.querySelectorAll(".calendar-gap.is-met")].some((card) => card.innerText.includes("3 z 3"))', 'A met need of the day should stay visible')

  await evaluate(page, 'document.querySelector(".day.today .day-menu")?.setAttribute("open", "")')
  await clickByText(page, '.day.today .day-menu-panel button', 'Potřeba řidičů')
  await waitForEval(page, 'document.querySelector(".coverage-need-form")', 'Day need panel did not open')
  await evaluate(page, `document.querySelector('.coverage-need-list button[aria-label^="Více"]')?.click()`)
  await clickByText(page, '.coverage-need-form button', 'Uložit potřebu')
  await waitForEval(page, '!document.querySelector(".coverage-need-form") && document.body.innerText.includes("uložena.")', 'Day need was not saved')

  await clickPlannerMenu(page, 'Normy pokrytí')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Normy pokrytí")', 'Coverage norms should open from the planner')
  await assertEval(page, 'document.querySelector(".sidebar-nav button.active")?.innerText.trim() === "Plán směn"', 'Coverage norms should keep the planner menu item highlighted')
  await assertEval(page, 'document.querySelector(".coverage-needs-card")?.innerText.includes("3 řidiči")', 'Needs of particular days should be listed on the norms page')
  await clickByText(page, 'button', '+ Přidat pásmo')
  await fillByPlaceholder(page, 'Např. Noc, Páteční špička, Ples', 'Ples')
  await clickByText(page, '.shift-drawer button', 'Přidat pásmo')
  await waitForEval(page, '!document.querySelector(".shift-drawer") && [...document.querySelectorAll(".list-row-main")].some((row) => row.innerText.includes("Ples"))', 'A new coverage slot should be listed')

  await clickByText(page, '.sidebar-nav button', 'Dashboard')
  await waitForEval(page, 'document.querySelector(".page-tabs button.active")?.innerText.trim() === "Dnes"', 'Dashboard should open on the Dnes tab')
  await waitForEval(page, 'document.querySelectorAll(".dashboard-task").length > 0', 'Dashboard should list tasks with actions')
  await assertEval(page, '[...document.querySelectorAll(".topbar .actions button")].every((button) => !/Záloha|Export/.test(button.innerText))', 'Backup and export belong to settings, not the dashboard')
  await evaluate(page, '[...document.querySelectorAll(".dashboard-task-actions button")].find((button) => button.innerText.trim() === "Obsadit")?.click()')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Plán směn") && document.querySelector(".cover-fill")', 'Obsadit on a dashboard task should open the planner with the cover panel')
  await clickByText(page, '.shift-drawer-head button', 'Zavřít')
  await clickByText(page, '.sidebar-nav button', 'Dashboard')
  await waitForEval(page, 'document.querySelectorAll(".dashboard-task").length > 0', 'Dashboard did not reopen')
  // demo shifts move with the calendar, so an unconfirmed shift within 48 hours is not there every day
  if (await evaluate(page, '[...document.querySelectorAll(".dashboard-task-actions button")].some((button) => button.innerText.trim() === "Připomenout")')) {
    await clickByText(page, '.dashboard-task-actions button', 'Připomenout')
    await waitForEval(page, '[...document.querySelectorAll(".dashboard-task-actions .pill")].some((pill) => pill.innerText.includes("Připomenuto"))', 'A sent reminder should show instead of the button')
  }
  await clickByText(page, '.page-tabs button', 'Audit týdne')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Audit provozu")', 'Weekly audit tab did not open')
  await clickByText(page, '.page-tabs button', 'Historie změn')
  await waitForEval(page, 'document.querySelector("h2")?.innerText.includes("Historie změn")', 'Change history tab did not open')
  await assertEval(page, 'document.querySelector(".sidebar-nav button.active")?.innerText.trim() === "Dashboard"', 'Dashboard tabs should keep the dashboard menu item highlighted')

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

  await assertEval(page, 'getComputedStyle(document.querySelector(".staff-bottom-nav")).display !== "none" && getComputedStyle(document.querySelector(".sidebar")).display === "none"', 'Phones should use the bottom bar instead of the scrolling menu')
  await clickByText(page, '.staff-bottom-nav button', 'Více')
  await waitForEval(page, '[...document.querySelectorAll(".staff-more-list button")].some((button) => button.innerText.includes("Řidiči"))', 'Více should list the remaining pages')
  await clickByText(page, '.staff-more-list button', 'Nastavení')
  await waitForEval(page, 'document.querySelector(".app-topbar-title")?.innerText.trim() === "Nastavení" && !document.querySelector(".staff-more-sheet")', 'A page from Více should open and close the sheet')
  await assertEval(page, '[...document.querySelectorAll(".settings-exports button")].length === 2', 'Settings should offer backup and export')

  await clickByText(page, '.staff-bottom-nav button', 'Výčetky')
  await waitForEval(page, 'document.querySelector(".app-topbar-title")?.innerText.includes("Výčetky")', 'Mobile settlements screen did not open')
  await assertEval(page, 'getComputedStyle(document.querySelector(".settlement-mobile-list")).display !== "none"', 'Mobile settlements list should replace the desktop table')
  await assertEval(page, 'getComputedStyle(document.querySelector(".settlement-table")).display === "none"', 'Desktop settlement table should be hidden on mobile')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Staff mobile settlements should not overflow horizontally')

  await clickByText(page, '.staff-bottom-nav button', 'Notifikace')
  await waitForEval(page, 'document.querySelector(".notifications-card h3")?.textContent.includes("K vyřízení")', 'Mobile staff notifications did not open')
  await assertEval(page, 'document.querySelector(".notifications-card") && !document.querySelector(".staff-message-composer")', 'The message form should wait behind its button')
  await clickByText(page, '.topbar .actions button', 'Nová zpráva řidičům')
  await waitForEval(page, 'document.querySelector(".shift-drawer .staff-message-composer")', 'New message should open in a side panel')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Staff mobile notifications should not overflow horizontally')

  await fillByPlaceholder(page, 'Např. Provozní zpráva', 'Smoke zpráva dispečera')
  await fillByPlaceholder(page, 'Text, který přijde řidiči do aplikace a jako push notifikace.', 'Ověření komunikace dispečer–řidič.')
  await clickByText(page, '.staff-message-composer button', 'Odeslat zprávu')
  await clickByText(page, '.shift-drawer-head button', 'Zavřít')
  await evaluate(page, 'document.querySelector(".notifications-history")?.setAttribute("open", "")')
  await waitForEval(page, 'document.body.innerText.includes("Smoke zpráva dispečera")', 'Sent staff message did not appear in history')

  await clickByText(page, '.staff-bottom-nav button', 'Dashboard')
  await waitForEval(page, 'document.querySelector(".app-topbar-title")?.innerText.includes("Dashboard") && document.querySelector(".dashboard-tasks-card")', 'Dashboard did not open')
  await assertEval(page, '!document.querySelector(".topbar p")?.innerText.endsWith("..")', 'Dashboard date subtitle contains duplicate punctuation')
  await assertEval(page, `
    (() => {
      const title = [...document.querySelectorAll(".section-title h3")].find((item) => item.innerText.trim() === "Úkoly k vyřešení");
      const card = title?.closest(".card");
      const badge = Number(card?.querySelector(".section-title .pill")?.innerText || 0);
      const visibleIssues = card?.querySelectorAll(".dashboard-task").length || 0;
      return Boolean(card) && (visibleIssues === 0 || badge >= visibleIssues);
    })()
  `, 'Dashboard priority badge is zero while issues are visible')
}

async function runDriverChecks(page) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  })
  await page.send('Page.navigate', { url: appUrlWithParam('demoRole', 'driver') })
  await waitForEval(page, 'document.body && document.querySelector(".driver-bottom-nav")', 'Driver mobile shell did not render')
  await assertEval(page, 'document.querySelector(".driver-topbar-v2") && document.querySelector(".driver-main-v2")', 'Driver app shell is missing')
  await assertEval(page, 'document.body.innerText.includes("Domů") && document.body.innerText.includes("Dostupnost") && document.body.innerText.includes("Notifikace") && document.body.innerText.includes("Nastavení")', 'Driver bottom navigation labels are missing')
  await assertEval(page, 'document.querySelector(".driver-now") && document.body.innerText.includes("Moje další směny")', 'Driver home content did not render')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Driver mobile page should not overflow horizontally')
  await assertEval(page, '!/row-level security|violates row-level security/i.test(document.body.innerText)', 'Driver UI leaked a technical RLS error')

  // the whole shift from the driver's side: check in, finish, fill in and send the settlement
  await evaluate(page, `(() => {
    const pad = (n) => String(n).padStart(2, '0')
    const at = (minutes) => new Date(Math.round((Date.now() + minutes * 60000) / 60000) * 60000)
    const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    const hm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes())
    const shift = { id: 'smoke_now', driverId: 'drv_roman', vehicleId: 'car_tesla_1', type: 'day', status: 'assigned', date: iso(at(20)), start: hm(at(20)), end: hm(at(500)), note: '', instruction: '', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }
    localStorage.setItem('rbshift-manager-data-v4', JSON.stringify({ shifts: [shift] }))
    location.reload()
  })()`).catch(() => {})
  await waitForEval(page, 'document.querySelector(".driver-now.kind-checkIn")?.innerText.includes("nástup za")', 'A shift starting soon should offer check-in on the home card')
  await clickByText(page, '.driver-now button', 'Nastoupil jsem')
  await waitForEval(page, 'document.querySelector(".driver-now.kind-running")?.innerText.includes("končí za")', 'After check-in the home card should show the running shift')
  await clickByText(page, '.driver-now button', 'Ukončit směnu')
  await clickByText(page, '.driver-action-modal button', 'Ukončit směnu')
  await waitForEval(page, 'document.querySelector(".settlement-modal .settlement-group")', 'Finishing the shift should open the settlement form')
  await clickByText(page, '.settlement-bar button', 'Zkontrolovat a odeslat')
  await waitForEval(page, 'document.querySelector(".settlement-field.has-error input[name=\\"trzba\\"]")', 'Sending an empty settlement should point at the missing revenue')
  await evaluate(page, `(() => {
    const set = (name, value) => { const el = document.querySelector('.settlement-modal input[name="' + name + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set('kmStart', '152300'); set('kmEnd', '152545'); set('trzba', '4200')
  })()`)
  await clickByText(page, '.settlement-bar button', 'Zkontrolovat a odeslat')
  await waitForEval(page, 'document.querySelector(".settlement-review")?.innerText.includes("245 km")', 'The review should summarise the settlement before sending')
  await clickByText(page, '.settlement-review button', 'Odeslat ke schválení')
  await waitForEval(page, '!document.querySelector(".settlement-modal") && !document.querySelector(".driver-now.kind-settlement")', 'A sent settlement should leave the home card')

  await clickByText(page, '.driver-calendar-card button', '4 týdny')
  await waitForEval(page, 'document.querySelector(".driver-calendar-modal .driver-day")', 'The 4-week calendar did not open')
  await evaluate(page, 'document.querySelectorAll(".driver-calendar-modal .driver-day")[3]?.click()')
  await waitForEval(page, 'document.querySelector(".driver-calendar-modal .driver-day-detail")', 'A day in the 4-week calendar should open its detail')
  await evaluate(page, 'document.querySelector(".driver-calendar-modal-close")?.click()')

  await clickByText(page, '.driver-bottom-nav button', 'Notifikace')
  await waitForEval(page, 'document.body.innerText.includes("Doručené")', 'Driver notifications screen did not open')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Driver notifications should not overflow horizontally')
  await clickByText(page, '.driver-bottom-nav button', 'Dostupnost')
  await waitForEval(page, 'document.querySelector(".driver-availability-quick") && document.body.innerText.includes("Moje dostupnost")', 'Driver availability screen did not open')
  await clickByText(page, '.driver-availability-quick button', 'Dovolená')
  await waitForEval(page, 'document.querySelector(".driver-availability-modal .availability-form")', 'A quick start should open the prefilled form')
  await clickByText(page, '.driver-availability-modal button', 'Uložit záznam')
  await waitForEval(page, '!document.querySelector(".driver-availability-modal") && document.body.innerText.includes("Dovolená a nemoc")', 'A saved absence should be listed')
  await assertEval(page, '!document.querySelector(".driver-availability-list .danger, .driver-availability-list [aria-label^=\\"Odstranit\\"]")', 'The availability list should not carry delete buttons')
  await evaluate(page, '[...document.querySelectorAll(".driver-availability-row")].find((row) => row.innerText.includes("Dovolená"))?.click()')
  await waitForEval(page, '[...document.querySelectorAll(".driver-availability-modal button")].some((button) => button.innerText.trim() === "Odstranit záznam")', 'A listed entry should open its detail with the removal')
  await clickByText(page, '.driver-availability-modal button', 'Odstranit záznam')
  await waitForEval(page, '!document.querySelector(".driver-availability-modal") && document.querySelector(".app-notice .app-notice-undo")', 'Removing an entry should offer undo')
  await clickByText(page, '.app-notice button', 'Vrátit zpět')
  await waitForEval(page, 'document.body.innerText.includes("Dovolená a nemoc")', 'Undo should list the removed absence again')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Driver availability should not overflow horizontally')
  await clickByText(page, '.driver-bottom-nav button', 'Nastavení')
  await waitForEval(page, 'document.body.innerText.includes("Upozornění na směny")', 'Driver settings screen did not open')
  await assertEval(page, 'document.documentElement.scrollWidth <= window.innerWidth + 1', 'Driver settings should not overflow horizontally')
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
  if (smokeScope !== 'driver') await runStaffChecks(page)
  if (smokeScope !== 'staff') await runDriverChecks(page)

  browser.close()
  if (consoleProblems.length) {
    throw new Error(`Browser console reported problems:\n${[...new Set(consoleProblems)].join('\n')}`)
  }
}

async function stopChild(child) {
  if (!child || child.killed) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await Promise.race([exited, delay(1000)])
}

async function cleanup() {
  stopping = true
  await Promise.all([stopChild(chromeProcess), stopChild(appProcess)])
  if (chromeProfile) rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
