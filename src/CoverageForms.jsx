import { useEffect, useState } from 'react'
import { formatDate, isPlausiblePlanDate } from './lib/dateTime.js'
import { czechCount } from './lib/drivers.js'
import { shiftNoticeBody } from './lib/display.js'
import { addNotificationsToData } from './lib/notifications.js'
import { showNotice } from './lib/notice.js'
import { buildHelpers } from './lib/shiftHelpers.js'
import { clampCoverageNeed, COVERAGE_NEED_MAX, coverageDayRows, setCoverageNeedsForDay } from './lib/coverage.js'
import { coverBatchProblems, coverShifts, driverChoiceIsClear, driverChoices, vehicleChoices } from './lib/shiftForm.js'

export function NeedStepper({ value, onChange, label, max = COVERAGE_NEED_MAX }) {
  return <div className="coverage-stepper">
    <button type="button" aria-label={`Méně – ${label}`} onClick={() => onChange(clampCoverageNeed(value - 1))} disabled={value <= 0}>−</button>
    <input type="number" inputMode="numeric" min="0" max={max} aria-label={label} value={value} onFocus={(event) => event.target.select()} onChange={(event) => onChange(clampCoverageNeed(event.target.value))} />
    <button type="button" aria-label={`Více – ${label}`} onClick={() => onChange(clampCoverageNeed(value + 1))} disabled={value >= max}>+</button>
  </div>
}

// How many drivers each slot needs on one day. Saving changes only that day; the weekly norms stay.
export function DayNeedForm({ data, commit, date: initialDate, today, chooseDate = false, onSaved, onCancel, onOpenNorms, onDirtyChange, ui }) {
  const { Field } = ui
  const [date, setDate] = useState(initialDate)
  const rows = date ? coverageDayRows(data, date) : []
  // only the values someone changed; untouched slots keep following the saved plan
  const [values, setValues] = useState({})
  const valueOf = (row) => values[row.id] ?? row.need
  const changed = rows.some((row) => valueOf(row) !== row.need)
  useEffect(() => { onDirtyChange?.(changed) }, [changed, onDirtyChange])

  const changeDate = (next) => {
    setDate(next)
    setValues({})
  }
  const save = (event) => {
    event.preventDefault()
    if (!isPlausiblePlanDate(date) || date < today) return showNotice('Vyberte dnešní nebo pozdější den.')
    if (!changed) return onCancel?.()
    const dayValues = Object.fromEntries(rows.filter((row) => Object.hasOwn(values, row.id)).map((row) => [row.id, values[row.id]]))
    commit((prev) => ({ ...prev, settings: setCoverageNeedsForDay(prev.settings, date, dayValues, today) }), `Upravena potřeba řidičů na ${formatDate(date)}.`)
    onSaved?.(date)
  }

  if (!(data.settings?.coverageSlots || []).length) return <div className="stack">
    <div className="empty">Zatím nemáte žádné pásmo pokrytí, pro které by šla potřeba nastavit.</div>
    {onOpenNorms && <button type="button" className="primary" onClick={onOpenNorms}>Přidat pásmo v normách</button>}
  </div>

  return <form className="coverage-need-form" onSubmit={save}>
    {chooseDate
      ? <Field label="Den"><input type="date" min={today} value={date} onChange={(event) => changeDate(event.target.value)} required /></Field>
      : <p className="coverage-form-day">{formatDate(date)}</p>}
    <p className="hintline">Změna platí jen pro tento den, běžné normy zůstanou.</p>
    <ul className="coverage-need-list">
      {rows.map((row) => {
        const value = valueOf(row)
        return <li key={row.id} className={value !== row.base ? 'is-changed' : ''}>
          <div className="coverage-need-slot">
            <b>{row.name}</b>
            <small>{row.start}–{row.end} · naplánováno {row.planned}</small>
          </div>
          <NeedStepper value={value} label={`potřeba řidičů, ${row.name}`} onChange={(next) => setValues((current) => ({ ...current, [row.id]: next }))} />
          <small className="coverage-need-base">
            běžně {row.base}
            {value !== row.base && <> · <button type="button" className="coverage-link" onClick={() => setValues((current) => ({ ...current, [row.id]: row.base }))}>vrátit</button></>}
          </small>
        </li>
      })}
    </ul>
    <div className="drawer-form-actions">
      <button className="primary" type="submit" disabled={!changed}>Uložit potřebu</button>
      <button className="ghost" type="button" onClick={onCancel}>Zrušit</button>
    </div>
  </form>
}

const createdSummary = (driverShifts, openShifts) => [
  driverShifts ? czechCount(driverShifts, 'směna pro řidiče', 'směny pro řidiče', 'směn pro řidiče') : '',
  openShifts ? czechCount(openShifts, 'volná směna', 'volné směny', 'volných směn') : '',
].filter(Boolean).join(' a ')

const saveLabel = (driverShifts, openShifts) => {
  if (driverShifts && openShifts) return `Vytvořit ${czechCount(driverShifts, 'směnu', 'směny', 'směn')} a ${czechCount(openShifts, 'volnou', 'volné', 'volných')}`
  if (driverShifts) return `Vytvořit ${czechCount(driverShifts, 'směnu', 'směny', 'směn')}`
  if (openShifts) return `Vypsat ${czechCount(openShifts, 'volnou směnu', 'volné směny', 'volných směn')}`
  return 'Vyberte řidiče nebo volné směny'
}

// Fills a coverage slot at once: each picked driver gets a shift, the rest can go out as open shifts.
export function CoverFillForm({ data, commit, gap, onSaved, onCancel, onChangeNeed, onDetailedForm, onDirtyChange, ui, services }) {
  const { ConflictBox } = ui
  const { uid, makeNotice } = services
  const row = coverageDayRows(data, gap.day).find((item) => item.id === gap.id) || gap
  const [picked, setPicked] = useState({})
  const [openCount, setOpenCount] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const [override, setOverride] = useState(false)
  const helpers = buildHelpers(data)
  const slotShift = { id: 'cover-slot', date: row.day, start: row.start, end: row.end }
  const choices = driverChoices(data, slotShift)
  const vehicles = vehicleChoices(data, slotShift)
  const picks = choices.filter((choice) => Object.hasOwn(picked, choice.driver.id)).map((choice) => ({ driverId: choice.driver.id, vehicleId: picked[choice.driver.id] }))
  const remaining = Math.max(0, row.missing - picks.length)
  let previewId = 0
  const preview = coverShifts({ gap: row, picks, confirmed, settings: data.settings, uid: (prefix) => `${prefix}_cover_preview_${++previewId}` })
  const problems = picks.length ? coverBatchProblems(data, preview, buildHelpers) : []
  const dirty = picks.length + openCount > 0
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  const togglePick = (driverId) => setPicked((current) => {
    const next = { ...current }
    if (Object.hasOwn(next, driverId)) delete next[driverId]
    else next[driverId] = ''
    return next
  })
  const carHolder = (vehicleId, driverId) => picks.find((pick) => pick.vehicleId === vehicleId && pick.driverId !== driverId)
  const save = () => {
    if (!picks.length && !openCount) return
    if (problems.length && !override) return showNotice('Některé směny mají kolizi nebo nemají vůz. Opravte to, nebo zaškrtněte uložení i tak.')
    const shifts = coverShifts({ gap: row, picks, openCount, confirmed, settings: data.settings, uid })
    const driverShifts = shifts.filter((shift) => shift.driverId)
    const openShifts = shifts.filter((shift) => !shift.driverId)
    const notices = driverShifts.map((shift) => makeNotice({ title: 'Nová směna', body: shiftNoticeBody(shift, helpers), targetDriverId: shift.driverId, type: 'new-shift', shiftId: shift.id }))
    // one notice for all open places, so drivers are not flooded with identical messages
    if (openShifts.length) notices.push(makeNotice({
      title: openShifts.length === 1 ? 'Nová volná směna' : 'Nové volné směny',
      body: shiftNoticeBody(openShifts[0], helpers, openShifts.length === 1 ? 'můžeš se přihlásit' : `${czechCount(openShifts.length, 'volné místo', 'volná místa', 'volných míst')}, můžeš se přihlásit`),
      targetRole: 'driver_all',
      type: 'open-shift',
      shiftId: openShifts[0].id,
    }))
    const summary = createdSummary(driverShifts.length, openShifts.length)
    commit((prev) => addNotificationsToData({ ...prev, shifts: [...shifts, ...prev.shifts] }, notices), `Obsazení ${row.name} ${formatDate(row.day)} ${row.start}–${row.end}: ${summary}.`)
    onSaved?.(summary)
  }

  const groups = [['Můžou jet', choices.filter(driverChoiceIsClear)], ['S překážkou', choices.filter((choice) => !driverChoiceIsClear(choice))]]
  return <div className="cover-fill">
    <div className="cover-fill-head">
      <div className="cover-fill-when"><span>{formatDate(row.day)}</span><strong>{row.name} {row.start}–{row.end}</strong></div>
      <div className={`cover-fill-status ${row.missing ? 'is-missing' : 'is-met'}`}>
        <b>{row.planned} z {row.need}</b>
        <small>{row.missing ? `chybí ${row.missing}` : 'potřeba splněna'}{row.open ? ` · ${czechCount(row.open, 'volná', 'volné', 'volných')}` : ''}</small>
      </div>
    </div>
    {(onChangeNeed || onDetailedForm) && <div className="cover-fill-links">
      {onChangeNeed && <button type="button" className="coverage-link" onClick={onChangeNeed}>Změnit potřebu na tento den</button>}
      {onDetailedForm && <button type="button" className="coverage-link" onClick={onDetailedForm}>Jedna směna s podrobnostmi</button>}
    </div>}

    <section className="cover-fill-section" aria-label="Řidiči">
      <div className="cover-fill-section-title">
        <h4>Řidiči</h4>
        <span className={picks.length ? 'pill good' : 'pill'}>{picks.length ? `vybráno ${picks.length}` : 'nikdo nevybrán'}</span>
      </div>
      {groups.map(([label, items]) => items.length > 0 && <div className="cover-driver-group" key={label}>
        <p className="cover-driver-group-title">{label}</p>
        <ul className="cover-driver-list">
          {items.map((choice) => {
            const checked = Object.hasOwn(picked, choice.driver.id)
            return <li key={choice.driver.id} className={checked ? 'is-picked' : ''}>
              <label className="cover-driver-pick">
                <input type="checkbox" checked={checked} onChange={() => togglePick(choice.driver.id)} />
                <span><b>{choice.driver.name}</b>{choice.note && <small>{choice.note}</small>}</span>
              </label>
              {checked && <select className="cover-driver-car" aria-label={`Vůz pro řidiče ${choice.driver.name}`} value={picked[choice.driver.id]} onChange={(event) => setPicked((current) => ({ ...current, [choice.driver.id]: event.target.value }))}>
                <option value="">Bez vozu / doplnit později</option>
                {vehicles.map((item) => {
                  const holder = carHolder(item.vehicle.id, choice.driver.id)
                  const note = holder ? `vybráno pro ${helpers.driverName(holder.driverId)}` : item.note
                  return <option key={item.vehicle.id} value={item.vehicle.id}>{item.vehicle.name} · {item.vehicle.plate}{note ? ` · ${note}` : ''}</option>
                })}
              </select>}
            </li>
          })}
        </ul>
      </div>)}
      {!choices.length && <div className="empty">Nemáte žádné aktivní řidiče.</div>}
    </section>

    <section className="cover-fill-section" aria-label="Volné směny">
      <div className="cover-open-row">
        <div><h4>Volné směny</h4><small>Řidiči se na ně přihlásí v aplikaci.</small></div>
        <NeedStepper value={openCount} label="počet volných směn" onChange={setOpenCount} />
      </div>
      {remaining > 0 && openCount !== remaining && <button type="button" className="coverage-link" onClick={() => setOpenCount(remaining)}>Vypsat zbývající jako volné ({remaining})</button>}
    </section>

    {picks.length > 0 && <label className="shift-form-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Řidiči směnu už potvrdili</label>}
    {problems.length > 0 && <>
      <ConflictBox messages={problems} />
      <label className="shift-form-check"><input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} />Uložit i s kolizí / bez vozu</label>
    </>}
    <div className="drawer-form-actions">
      <button type="button" className="primary" disabled={!picks.length && !openCount} onClick={save}>{saveLabel(picks.length, openCount)}</button>
      <button type="button" className="ghost" onClick={onCancel}>Zrušit</button>
    </div>
  </div>
}
