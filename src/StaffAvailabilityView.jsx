import { useState } from 'react'
import { Plus } from 'lucide-react'
import { addDays, EARLIEST_PLAN_DATE, formatDate, LATEST_PLAN_DATE, startOfWeek, todayISO, weekdayOf } from './lib/dateTime.js'
import { availabilityLabel } from './lib/availability.js'
import { weekdayMap } from './lib/appConfig.js'
import { dateRangeLabel } from './lib/display.js'
import { uid } from './lib/ids.js'
import { showNotice } from './lib/notice.js'
import { absenceFromForm, availabilityEntryFromForm, availabilityPresets, availabilityWeekGrid } from './lib/availabilityGrid.js'

const entryTypes = [['available', 'Může jet'], ['preferred', 'Preferuje'], ['unavailable', 'Nemůže'], ['absent', 'Nepřítomnost']]
const kindLabels = { available: 'Může jet', preferred: 'Preferuje', unavailable: 'Nemůže', absent: 'Nepřítomnost' }
const absenceReasons = ['Dovolená', 'Nemoc', 'Volno']
const everyWeekday = { 0: 'každou neděli', 1: 'každé pondělí', 2: 'každé úterý', 3: 'každou středu', 4: 'každý čtvrtek', 5: 'každý pátek', 6: 'každou sobotu' }

const blankForm = (driverId = '', date = todayISO()) => ({ type: 'available', driverId, date, start: '06:00', end: '14:00', repeatWeekly: false, note: '', from: date, to: date, reason: '' })
// the repeat mark stays on the same line as the time
const chipText = (item) => (item.kind === 'unavailable' ? `nemůže ${item.label}` : item.label) + (item.weekly ? '\u00a0↻' : '')
const chipTitle = (item) => `${kindLabels[item.kind]}: ${item.label}${item.weekly ? ', každý týden' : ''}${item.note ? ` · ${item.note}` : ''}`

// Dispatch view of availability: active drivers × days of a week, with + in every cell and details on a tap.
export function StaffAvailability({ data, commit, today = todayISO(), ui }) {
  const { ActionSummary, ConfirmActionModal, Field, PageTitle, SideDrawer } = ui
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today))
  const [pickedDay, setPickedDay] = useState(today)
  const [form, setForm] = useState(null)
  const [detail, setDetail] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const grid = availabilityWeekGrid(data, weekStart)
  const activeDay = grid.days.includes(pickedDay) ? pickedDay : grid.days[0]
  const drivers = grid.rows.map((row) => row.driver)
  const driverName = (id) => (data.drivers || []).find((driver) => driver.id === id)?.name || 'Řidič'

  const moveWeek = (days) => setWeekStart((current) => addDays(current, days))
  const openNew = (driverId = drivers[0]?.id || '', date = activeDay) => {
    if (!drivers.length) return showNotice('Nejdřív přidejte aktivního řidiče.')
    setForm(blankForm(driverId, date))
  }
  const update = (patch) => setForm((current) => ({ ...current, ...patch }))
  const submit = (event) => {
    event.preventDefault()
    if (form.type === 'absent') {
      const { entry, error } = absenceFromForm(form, uid('abs'))
      if (error) return showNotice(error)
      commit((prev) => ({ ...prev, absences: [entry, ...(prev.absences || [])] }), `Přidána nepřítomnost řidiče ${driverName(entry.driverId)} (${dateRangeLabel(entry.from, entry.to)}).`)
    } else {
      const { entry, error } = availabilityEntryFromForm(form, uid('av'))
      if (error) return showNotice(error)
      commit((prev) => ({ ...prev, availability: [entry, ...(prev.availability || [])] }), `Přidána dostupnost řidiče ${driverName(entry.driverId)}: ${availabilityLabel(entry)}.`)
    }
    setForm(null)
  }
  const confirmRemove = () => {
    if (!detail) return
    if (detail.type === 'absence') commit((prev) => ({ ...prev, absences: (prev.absences || []).filter((item) => item.id !== detail.id) }), `Odstraněna nepřítomnost řidiče ${driverName(detail.entry.driverId)}.`)
    else commit((prev) => ({ ...prev, availability: (prev.availability || []).filter((item) => item.id !== detail.id) }), `Odstraněna dostupnost řidiče ${driverName(detail.entry.driverId)}.`)
    setDeleteOpen(false)
    setDetail(null)
  }
  const chips = (items) => items.map((item) => <button type="button" key={item.id} className={`availability-chip kind-${item.kind}`} title={chipTitle(item)} aria-label={chipTitle(item)} onClick={() => setDetail(item)}>{chipText(item)}</button>)
  const detailMeta = detail?.type === 'absence'
    ? `${dateRangeLabel(detail.entry.from, detail.entry.to)}${detail.entry.reason ? ` · ${detail.entry.reason}` : ''}`
    : detail ? `${availabilityLabel(detail.entry)}${detail.note ? ` · ${detail.note}` : ''}` : ''

  return <>
    <PageTitle title="Dostupnost řidičů" subtitle="Kdo může jet a kdo ne. Záznam přidáte tlačítkem + u řidiče a dne.">
      <div className="availability-week-nav">
        <button type="button" className="ghost" aria-label="Předchozí týden" title="Předchozí týden" onClick={() => moveWeek(-7)}>←</button>
        <button type="button" className="ghost" onClick={() => { setWeekStart(startOfWeek(today)); setPickedDay(today) }}>Tento týden</button>
        <button type="button" className="ghost" aria-label="Další týden" title="Další týden" onClick={() => moveWeek(7)}>→</button>
      </div>
      <button type="button" className="primary" onClick={() => openNew()}>+ Přidat záznam</button>
    </PageTitle>
    <div className="availability-legend" aria-label="Legenda">
      <span className="pill">{formatDate(grid.days[0])}–{formatDate(grid.days[6])}</span>
      {['available', 'preferred', 'unavailable', 'absent'].map((kind) => <span key={kind} className={`availability-chip is-legend kind-${kind}`}>{kindLabels[kind]}</span>)}
      <span className="muted availability-legend-note">↻ = každý týden</span>
    </div>

    {!grid.rows.length && <div className="card empty">Zatím nemáte žádné aktivní řidiče.</div>}

    {grid.rows.length > 0 && <div className="card availability-grid-card">
      <div className="availability-grid" role="table" aria-label="Dostupnost řidičů v týdnu">
        <div className="availability-grid-row availability-grid-head" role="row">
          <div role="columnheader" className="availability-grid-driver">Řidič</div>
          {grid.days.map((day) => <div role="columnheader" key={day} className={day === today ? 'is-today' : ''}>{formatDate(day)}</div>)}
        </div>
        {grid.rows.map((row) => <div className="availability-grid-row" role="row" key={row.driver.id}>
          <div role="rowheader" className="availability-grid-driver"><b>{row.driver.name}</b></div>
          {row.cells.map((cell) => <div role="cell" key={cell.day} className={`availability-cell ${cell.day === today ? 'is-today' : ''}`.trim()}>
            {chips(cell.items)}
            <button type="button" className="availability-add" aria-label={`Přidat záznam: ${row.driver.name}, ${formatDate(cell.day)}`} title="Přidat záznam" onClick={() => openNew(row.driver.id, cell.day)}><Plus size={15} strokeWidth={2.4} aria-hidden="true" /></button>
          </div>)}
        </div>)}
      </div>

      <div className="availability-mobile">
        <div className="availability-day-tabs" role="tablist" aria-label="Den v týdnu">
          {grid.days.map((day) => <button type="button" role="tab" key={day} aria-selected={day === activeDay} className={`${day === activeDay ? 'active' : ''} ${day === today ? 'is-today' : ''}`.trim()} onClick={() => setPickedDay(day)}>
            <span>{weekdayMap[weekdayOf(day)]}</span><b>{Number(day.slice(8, 10))}</b>
          </button>)}
        </div>
        <ul className="availability-day-list">
          {grid.rows.map((row) => {
            const cell = row.cells.find((item) => item.day === activeDay)
            return <li key={row.driver.id}>
              <div className="availability-day-driver"><b>{row.driver.name}</b>{!cell.items.length && <small className="muted">bez záznamu</small>}</div>
              {cell.items.length > 0 && <div className="availability-day-items">{chips(cell.items)}</div>}
              <button type="button" className="availability-add" aria-label={`Přidat záznam: ${row.driver.name}, ${formatDate(activeDay)}`} onClick={() => openNew(row.driver.id, activeDay)}><Plus size={16} strokeWidth={2.4} aria-hidden="true" /></button>
            </li>
          })}
        </ul>
      </div>
    </div>}

    <SideDrawer title="Nový záznam" open={Boolean(form)} onClose={() => setForm(null)}>
      {form && <form className="form two-col availability-form" onSubmit={submit}>
        <Field label="Řidič" className="span2"><select value={form.driverId} onChange={(event) => update({ driverId: event.target.value })}>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></Field>
        <div className="field span2">
          <label>Co zadáváte</label>
          <div className="availability-choice" role="radiogroup" aria-label="Typ záznamu">
            {entryTypes.map(([type, label]) => <button type="button" role="radio" key={type} aria-checked={form.type === type} className={`kind-${type} ${form.type === type ? 'active' : ''}`.trim()} onClick={() => update({ type })}>{label}</button>)}
          </div>
        </div>
        {form.type !== 'absent' ? <>
          <Field label="Den" className="span2"><input type="date" min={EARLIEST_PLAN_DATE} max={LATEST_PLAN_DATE} value={form.date} onChange={(event) => update({ date: event.target.value })} /></Field>
          <div className="field span2">
            <label>Čas</label>
            <div className="availability-choice availability-presets">
              {availabilityPresets.map(([key, label, start, end]) => <button type="button" key={key} className={form.start === start && form.end === end ? 'active' : ''} onClick={() => update({ start, end })}>{label}<small>{start}–{end}</small></button>)}
            </div>
          </div>
          <Field label="Od"><input type="time" value={form.start} onChange={(event) => update({ start: event.target.value })} /></Field>
          <Field label="Do"><input type="time" value={form.end} onChange={(event) => update({ end: event.target.value })} /></Field>
          {form.end && form.start && form.end < form.start && <p className="hintline span2 shift-form-hint">Končí následující den ráno.</p>}
          <label className="field span2 shift-form-check"><input type="checkbox" checked={form.repeatWeekly} onChange={(event) => update({ repeatWeekly: event.target.checked })} />Opakovat každý týden{form.date ? ` (${everyWeekday[weekdayOf(form.date)]})` : ''}</label>
          <Field label="Poznámka" className="span2"><input value={form.note} onChange={(event) => update({ note: event.target.value })} placeholder="Např. jen po domluvě" /></Field>
        </> : <>
          <Field label="Od"><input type="date" min={EARLIEST_PLAN_DATE} max={LATEST_PLAN_DATE} value={form.from} onChange={(event) => update({ from: event.target.value, to: form.to < event.target.value ? event.target.value : form.to })} /></Field>
          <Field label="Do"><input type="date" min={form.from || EARLIEST_PLAN_DATE} max={LATEST_PLAN_DATE} value={form.to} onChange={(event) => update({ to: event.target.value })} /></Field>
          <div className="field span2">
            <label>Důvod</label>
            <div className="availability-choice">
              {absenceReasons.map((reason) => <button type="button" key={reason} className={form.reason === reason ? 'active' : ''} onClick={() => update({ reason })}>{reason}</button>)}
            </div>
            <input value={form.reason} onChange={(event) => update({ reason: event.target.value })} placeholder="Nebo napište vlastní důvod" aria-label="Vlastní důvod" />
          </div>
        </>}
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">Uložit záznam</button>
          <button className="ghost" type="button" onClick={() => setForm(null)}>Zrušit</button>
        </div>
      </form>}
    </SideDrawer>

    <SideDrawer title={detail?.type === 'absence' ? 'Nepřítomnost' : 'Dostupnost'} open={Boolean(detail)} onClose={() => setDetail(null)}>
      {detail && <div className="stack availability-detail">
        <ActionSummary eyebrow={kindLabels[detail.kind]} title={driverName(detail.entry.driverId)} meta={detailMeta} />
        {detail.weekly && <p className="muted">Opakuje se každý týden. Odstranění platí pro všechny týdny.</p>}
        <button type="button" className="danger" onClick={() => setDeleteOpen(true)}>Odstranit záznam</button>
      </div>}
    </SideDrawer>
    {detail && deleteOpen && <ConfirmActionModal
      title={detail.type === 'absence' ? 'Odstranit nepřítomnost' : 'Odstranit dostupnost'}
      message={detail.weekly ? 'Záznam se opakuje každý týden, odstraní se ze všech týdnů.' : 'Záznam zmizí z dostupnosti řidiče a přestane se hlídat při plánování.'}
      confirmLabel="Odstranit"
      confirmClass="danger"
      onClose={() => setDeleteOpen(false)}
      onConfirm={confirmRemove}
    >
      <ActionSummary eyebrow={kindLabels[detail.kind]} title={driverName(detail.entry.driverId)} meta={detailMeta} />
    </ConfirmActionModal>}
  </>
}
