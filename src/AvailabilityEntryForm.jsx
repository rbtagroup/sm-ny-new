import { EARLIEST_PLAN_DATE, LATEST_PLAN_DATE, todayISO, weekdayOf } from './lib/dateTime.js'
import { availabilityPresets, everyWeekdayLabel } from './lib/availabilityGrid.js'

export const staffEntryTypes = [['available', 'Může jet'], ['preferred', 'Preferuje'], ['unavailable', 'Nemůže'], ['absent', 'Nepřítomnost']]
export const driverEntryTypes = [['available', 'Můžu jet'], ['preferred', 'Raději ano'], ['unavailable', 'Nemůžu'], ['absent', 'Dovolená / nemoc']]
const absenceReasons = ['Dovolená', 'Nemoc', 'Volno']

export const blankAvailabilityForm = (driverId = '', date = todayISO(), patch = {}) => ({ type: 'available', driverId, date, start: '06:00', end: '14:00', repeatWeekly: false, note: '', from: date, to: date, reason: '', ...patch })

// One form for availability and absences, used by dispatch (with a driver picker) and by drivers for themselves.
export function AvailabilityEntryForm({ form, onChange, onSubmit, onCancel, drivers = null, types = staffEntryTypes, ui }) {
  const { Field } = ui
  const update = (patch) => onChange({ ...form, ...patch })
  return <form className="form two-col availability-form" onSubmit={onSubmit}>
    {drivers && <Field label="Řidič" className="span2"><select value={form.driverId} onChange={(event) => update({ driverId: event.target.value })}>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></Field>}
    <div className="field span2">
      <label>Co zadáváte</label>
      <div className="availability-choice" role="radiogroup" aria-label="Typ záznamu">
        {types.map(([type, label]) => <button type="button" role="radio" key={type} aria-checked={form.type === type} className={`kind-${type} ${form.type === type ? 'active' : ''}`.trim()} onClick={() => update({ type })}>{label}</button>)}
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
      <label className="field span2 shift-form-check"><input type="checkbox" checked={form.repeatWeekly} onChange={(event) => update({ repeatWeekly: event.target.checked })} />Opakovat každý týden{form.date ? ` (${everyWeekdayLabel[weekdayOf(form.date)]})` : ''}</label>
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
      <button className="ghost" type="button" onClick={onCancel}>Zrušit</button>
    </div>
  </form>
}
