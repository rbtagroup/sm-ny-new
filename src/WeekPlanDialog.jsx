import { useMemo, useState } from 'react'
import { addDays, formatDate } from './lib/dateTime.js'
import { czechCount } from './lib/drivers.js'
import { activeShiftsInWeek, planWeek } from './lib/weekPlan.js'
import { coverageNeedsList } from './lib/coverage.js'

const DUPLICATE_REASON = 'Stejná směna už v týdnu je.'
const shiftCount = (count) => czechCount(count, 'směna', 'směny', 'směn')
const weekLabel = (weekStart) => `${formatDate(weekStart)}–${formatDate(addDays(weekStart, 6))}`

export function WeekPlanDialog({ data, weeks, helpers, commit, services, ui, onClose, onPlanned }) {
  const { ConfirmActionModal } = ui
  const { buildHelpers, uid } = services
  const [targetWeekStart, setTargetWeekStart] = useState(() => weeks.find((week) => !activeShiftsInWeek(data.shifts, week).length) || weeks.at(-1))
  const [copyShifts, setCopyShifts] = useState(() => activeShiftsInWeek(data.shifts, addDays(targetWeekStart, -7)).length > 0)
  const [fillGaps, setFillGaps] = useState(false)
  const [allowConflicts, setAllowConflicts] = useState(false)
  const sourceWeekStart = addDays(targetWeekStart, -7)
  const sourceCount = activeShiftsInWeek(data.shifts, sourceWeekStart).length
  const hasCoverageNorms = (data.settings?.coverageSlots || []).some((slot) => Number(slot.minDrivers) > 0) || coverageNeedsList(data.settings).some((entry) => entry.minDrivers > 0)
  const options = { data, targetWeekStart, sourceWeekStart, copyShifts, fillGaps, allowConflicts, buildHelpers }
  const preview = useMemo(() => {
    let counter = 0
    return planWeek({ data, targetWeekStart, sourceWeekStart, copyShifts, fillGaps, allowConflicts, buildHelpers, uid: (prefix) => `${prefix}_preview_${++counter}` })
  }, [data, targetWeekStart, sourceWeekStart, copyShifts, fillGaps, allowConflicts, buildHelpers])
  const drafts = preview.planned.filter(({ shift }) => shift.status === 'draft').length
  const openShifts = preview.planned.length - drafts
  const conflictsSkipped = preview.skipped.filter(({ reasons }) => reasons[0] !== DUPLICATE_REASON).length

  const confirm = () => {
    const created = planWeek({ ...options, uid }).planned.map(({ shift }) => shift)
    if (!created.length) return
    commit((prev) => ({ ...prev, shifts: [...created, ...prev.shifts] }), `Naplánován týden ${weekLabel(targetWeekStart)}: ${shiftCount(created.length)}.`)
    onPlanned?.(created.length)
  }

  return <ConfirmActionModal
    title="Naplánovat týden"
    message="Vyber týden a co do něj připravit. Nic se neuloží, dokud nepotvrdíš."
    confirmLabel={preview.planned.length ? `Vytvořit ${czechCount(preview.planned.length, 'směnu', 'směny', 'směn')}` : 'Není co vytvořit'}
    confirmDisabled={!preview.planned.length}
    onClose={onClose}
    onConfirm={confirm}
  >
    <div className="week-plan-weeks" role="radiogroup" aria-label="Plánovaný týden">
      {weeks.map((week) => <button key={week} type="button" role="radio" aria-checked={week === targetWeekStart} className={week === targetWeekStart ? 'active' : ''} onClick={() => setTargetWeekStart(week)}>
        <span>{weekLabel(week)}</span>
        <small>{activeShiftsInWeek(data.shifts, week).length ? `už ${shiftCount(activeShiftsInWeek(data.shifts, week).length)}` : 'zatím prázdný'}</small>
      </button>)}
    </div>
    <label className="week-plan-option">
      <input type="checkbox" checked={copyShifts} onChange={(event) => setCopyShifts(event.target.checked)} />
      <span><b>Zkopírovat předchozí týden</b><small>{weekLabel(sourceWeekStart)} · {shiftCount(sourceCount)} se stejnými řidiči, auty a časy</small></span>
    </label>
    {hasCoverageNorms && <label className="week-plan-option">
      <input type="checkbox" checked={fillGaps} onChange={(event) => setFillGaps(event.target.checked)} />
      <span><b>Doplnit chybějící pokrytí volnými směnami</b><small>Podle norem pokrytí; řidiči se na volné směny přihlásí sami.</small></span>
    </label>}
    {(conflictsSkipped > 0 || allowConflicts) && <label className="week-plan-option">
      <input type="checkbox" checked={allowConflicts} onChange={(event) => setAllowConflicts(event.target.checked)} />
      <span><b>Vytvořit i směny s problémem</b><small>Problémy pak uvidíš v plánu a vyřešíš je ručně.</small></span>
    </label>}
    <div className="week-plan-summary" aria-live="polite">
      {preview.planned.length
        ? `Vytvoří se ${shiftCount(preview.planned.length)}: ${czechCount(drafts, 'návrh', 'návrhy', 'návrhů')} pro řidiče, ${czechCount(openShifts, 'volná', 'volné', 'volných')}.`
        : 'Podle vybraných voleb se nic nevytvoří.'}
    </div>
    {preview.planned.length > 0 && <ul className="week-plan-list">
      {preview.planned.map(({ shift, note }, index) => <li key={index} className={shift.status === 'open' ? 'open' : ''}>
        <b>{formatDate(shift.date)} · {shift.start}–{shift.end}</b>
        <span>{shift.driverId ? helpers.driverName(shift.driverId) : 'Volná směna'} · {helpers.vehicleName(shift.vehicleId)}</span>
        {note && <small>{note}</small>}
      </li>)}
    </ul>}
    {preview.skipped.length > 0 && <details className="week-plan-skipped">
      <summary>Přeskočeno: {shiftCount(preview.skipped.length)}</summary>
      <ul>{preview.skipped.map(({ shift, reasons }, index) => <li key={index}><b>{formatDate(shift.date)} {shift.start}–{shift.end}</b> · {shift.driverId ? helpers.driverName(shift.driverId) : 'volná'}: {reasons.join(' ')}</li>)}</ul>
    </details>}
    <p className="muted week-plan-hint">Řidičům se nic neposílá. Své směny uvidí v aplikaci jako návrh k potvrzení, volné směny v nabídce.</p>
  </ConfirmActionModal>
}
