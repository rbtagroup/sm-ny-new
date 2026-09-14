import { useState } from 'react'
import { addDays, formatDate, todayISO } from './lib/dateTime.js'
import { dateRangeLabel, sortByDateTime, todayRangeTitle } from './lib/display.js'
import { confirmReminderNotice, dashboardOperationalIssues } from './lib/dashboard.js'
import { czechCount } from './lib/drivers.js'
import { addNotificationsToData } from './lib/notifications.js'
import { showNotice } from './lib/notice.js'
import { dayText } from './lib/shiftExports.js'
import { resolveSwapRequest } from './lib/swapRequests.js'
import { ShiftTable } from './StaffShiftTable.jsx'

const TASKS_SHOWN = 8
const clockTime = (value) => new Date(value).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })

export function Dashboard({ data, helpers, commit, today = todayISO(), ui, services, tabs = null, onOpenPlanner }) {
  const { PageTitle, Kpi, StatusPill } = ui
  const { copyText, makeNotice, shiftTableUi, shiftTableServices } = services
  const [allTasksShown, setAllTasksShown] = useState(false)
  const tomorrow = addDays(today, 1)
  const todayShifts = sortByDateTime(data.shifts.filter((shift) => shift.date === today))
  const tomorrowShifts = sortByDateTime(data.shifts.filter((shift) => shift.date === tomorrow))
  const waiting = sortByDateTime(data.shifts.filter((shift) => ['assigned', 'draft', 'open'].includes(shift.status) && shift.date >= today))
  const carsToday = new Set(todayShifts.filter((shift) => !['cancelled', 'declined'].includes(shift.status)).map((shift) => shift.vehicleId))
  const driversToday = new Set(todayShifts.filter((shift) => !['cancelled', 'declined'].includes(shift.status)).map((shift) => shift.driverId))
  const freeCars = data.vehicles.filter((vehicle) => vehicle.active && !carsToday.has(vehicle.id))
  const freeDrivers = data.drivers.filter((driver) => driver.active && !driversToday.has(driver.id))
  const { conflicts, pendingSwaps, gaps, tasks } = dashboardOperationalIssues(data, helpers, today)
  const running = todayShifts.filter((shift) => shift.actualStartAt && !shift.actualEndAt)
  const shownTasks = allTasksShown ? tasks : tasks.slice(0, TASKS_SHOWN)

  const remind = (shift) => {
    commit((prev) => addNotificationsToData(prev, confirmReminderNotice(shift, helpers, makeNotice)), `Připomenuto potvrzení směny ${formatDate(shift.date)} ${shift.start}–${shift.end} řidiči ${helpers.driverName(shift.driverId)}.`)
    showNotice(`Připomínka odeslána: ${helpers.driverName(shift.driverId)}.`, { tone: 'good' })
  }
  const resolveSwap = (request, status) => {
    const options = { requestId: request.id, status, helpers, makeNotice }
    const preview = resolveSwapRequest(data, options)
    if (preview.error) return showNotice(preview.error)
    commit((prev) => resolveSwapRequest(prev, options).data, preview.message)
  }
  const taskActions = (task) => {
    if (task.kind === 'gap') return <button type="button" className="ghost" onClick={() => onOpenPlanner?.({ type: 'cover', gap: task.gap })}>Obsadit</button>
    if (task.kind === 'declined') return <button type="button" className="primary" onClick={() => onOpenPlanner?.({ type: 'reassign', shiftId: task.shift.id })}>Najít náhradu</button>
    if (task.kind === 'confirm') return task.remindedRecently
      ? <span className="pill good">Připomenuto {clockTime(task.remindedAt)}</span>
      : <button type="button" className="primary" onClick={() => remind(task.shift)}>Připomenout</button>
    if (task.kind === 'swap' && task.approvable) return <>
      <button type="button" className="primary" onClick={() => resolveSwap(task.request, 'approved')}>Schválit</button>
      <button type="button" className="ghost" onClick={() => resolveSwap(task.request, 'rejected')}>Zamítnout</button>
    </>
    return task.shift ? <button type="button" className="ghost" onClick={() => onOpenPlanner?.({ type: 'shift', shiftId: task.shift.id })}>Otevřít směnu</button> : null
  }

  return <>
    <PageTitle title="Provozní dashboard" subtitle={`Dnes je ${todayRangeTitle(today)}`}>
      <button className="ghost" onClick={() => copyText(dayText(data, helpers, today))}>Zkopírovat dnešní plán</button>
    </PageTitle>
    {tabs}
    <div className="grid kpis dashboard-kpis">
      <Kpi label="Dnešní směny" value={todayShifts.length} hint={`${todayShifts.filter((shift) => shift.status === 'confirmed').length} potvrzeno · ${todayShifts.filter((shift) => shift.status === 'completed').length} hotovo`} />
      <Kpi label="Čeká na reakci" value={waiting.length} hint="Budoucí návrh / čeká na potvrzení" />
      <Kpi label="Běží směny" value={running.length} hint="Nástup bez ukončení" kind={running.length ? 'warn' : ''} />
      <Kpi label="Kolize" value={conflicts.length} hint={conflicts.length ? 'Nutná kontrola' : 'Bez zásahu'} kind={conflicts.length ? 'bad' : 'good'} />
      <Kpi label="Výměny / obsazení" value={pendingSwaps.length + gaps.length} hint={`${czechCount(pendingSwaps.length, 'výměna', 'výměny', 'výměn')} · ${czechCount(gaps.length, 'díra', 'díry', 'děr')}`} kind={pendingSwaps.length + gaps.length ? 'bad' : 'good'} />
    </div>
    <div className="grid" style={{ marginTop: 16 }}>
      <div className="card dashboard-tasks-card">
        <div className="section-title"><h3>Úkoly k vyřešení</h3><span className={tasks.length ? 'pill bad' : 'pill good'}>{tasks.length}</span></div>
        {tasks.length > 0 && <ul className="dashboard-tasks">
          {shownTasks.map((task) => <li className={`dashboard-task tone-${task.tone}`} key={task.key}>
            <div className="dashboard-task-copy">
              <span className="dashboard-task-title">{task.title}</span>
              <b>{task.when}</b>
              <small>{task.detail}</small>
            </div>
            <div className="dashboard-task-actions">{taskActions(task)}</div>
          </li>)}
        </ul>}
        {tasks.length > TASKS_SHOWN && <button type="button" className="ghost dashboard-tasks-more" onClick={() => setAllTasksShown((shown) => !shown)}>{allTasksShown ? 'Zobrazit méně' : `Zobrazit všech ${tasks.length}`}</button>}
        {!tasks.length && <div className="empty">Nic nečeká: bez kolizí, odmítnutých směn, výměn a chybějícího obsazení.</div>}
      </div>
      <div className="card"><div className="section-title"><h3>Dnešní provoz</h3><span className="pill">{formatDate(today)}</span></div><ShiftTable shifts={todayShifts} data={data} helpers={helpers} commit={commit} compact ui={shiftTableUi} services={shiftTableServices} /></div>
    </div>
    <div className="grid three" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Čeká na potvrzení</h3><span className="pill warn">{waiting.length}</span></div><div className="quick-list">{waiting.slice(0, 8).map((shift) => <QuickShift key={shift.id} shift={shift} helpers={helpers} StatusPill={StatusPill} />)}{!waiting.length && <div className="empty">Nic nečeká.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Volná auta dnes</h3><span className="pill good">{freeCars.length}</span></div><div className="quick-list">{freeCars.map((vehicle) => <div className="quick-item" key={vehicle.id}><div><strong>{vehicle.name}</strong><small>{vehicle.plate}</small></div><span className="pill good">volné</span></div>)}{!freeCars.length && <div className="empty">Všechna aktivní auta jsou dnes v plánu.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Volní řidiči dnes</h3><span className="pill good">{freeDrivers.length}</span></div><div className="quick-list">{freeDrivers.map((driver) => <div className="quick-item" key={driver.id}><div><strong>{driver.name}</strong><small>{driver.phone || driver.email || 'bez kontaktu'}</small></div><span className="pill good">volný</span></div>)}{!freeDrivers.length && <div className="empty">Všichni aktivní řidiči jsou dnes v plánu.</div>}</div></div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Zítra</h3><span className="pill">{czechCount(tomorrowShifts.length, 'směna', 'směny', 'směn')}</span></div><pre className="copybox">{dayText(data, helpers, tomorrow)}</pre></div>
      <div className="card"><div className="section-title"><h3>Servis / nepřítomnosti</h3><span className="pill warn">{data.serviceBlocks.length + data.absences.length}</span></div><div className="stack">
        {data.serviceBlocks.slice(0, 4).map((service) => <div className="alert warn" key={service.id}>{helpers.vehicleName(service.vehicleId)} · {dateRangeLabel(service.from, service.to)}<br /><small>{service.reason}</small></div>)}
        {data.absences.slice(0, 4).map((absence) => <div className="alert warn" key={absence.id}>{helpers.driverName(absence.driverId)} · {dateRangeLabel(absence.from, absence.to)}<br /><small>{absence.reason}</small></div>)}
        {!data.serviceBlocks.length && !data.absences.length && <div className="empty">Bez blokací.</div>}
      </div></div>
    </div>
  </>
}

function QuickShift({ shift, helpers, StatusPill }) {
  return <div className="quick-item"><div><strong>{formatDate(shift.date)} {shift.start}–{shift.end}</strong><small>{helpers.driverName(shift.driverId)} · {helpers.vehicleName(shift.vehicleId)}</small></div><StatusPill status={shift.status} helpers={helpers} /></div>
}
