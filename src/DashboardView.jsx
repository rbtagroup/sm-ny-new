import { addDays, formatDate, todayISO } from './lib/dateTime.js'
import { sortByDateTime, todayRangeTitle } from './lib/display.js'
import { dashboardOperationalIssues } from './lib/dashboard.js'
import { backup, dayText, exportCSV } from './lib/shiftExports.js'
import { ShiftTable } from './StaffShiftTable.jsx'

export function Dashboard({ data, helpers, commit, today = todayISO(), ui, services }) {
  const { PageTitle, Kpi, StatusPill } = ui
  const { copyText, shiftTableUi, shiftTableServices } = services
  const tomorrow = addDays(today, 1)
  const todayShifts = sortByDateTime(data.shifts.filter((shift) => shift.date === today))
  const tomorrowShifts = sortByDateTime(data.shifts.filter((shift) => shift.date === tomorrow))
  const waiting = sortByDateTime(data.shifts.filter((shift) => ['assigned', 'draft', 'open'].includes(shift.status) && shift.date >= today))
  const carsToday = new Set(todayShifts.filter((shift) => !['cancelled', 'declined'].includes(shift.status)).map((shift) => shift.vehicleId))
  const driversToday = new Set(todayShifts.filter((shift) => !['cancelled', 'declined'].includes(shift.status)).map((shift) => shift.driverId))
  const freeCars = data.vehicles.filter((vehicle) => vehicle.active && !carsToday.has(vehicle.id))
  const freeDrivers = data.drivers.filter((driver) => driver.active && !driversToday.has(driver.id))
  const { conflicts, declined, pendingSwaps, gaps, count: priorityCount } = dashboardOperationalIssues(data, helpers, today)
  const running = todayShifts.filter((shift) => shift.actualStartAt && !shift.actualEndAt)

  return <>
    <PageTitle title="Provozní dashboard" subtitle={`Dnes je ${todayRangeTitle(today)}`}>
      <button className="ghost" onClick={() => copyText(dayText(data, helpers, today))}>WhatsApp dnes</button>
      <button className="ghost" onClick={() => exportCSV(data, helpers)}>Export CSV</button>
      <button className="primary" onClick={() => backup(data)}>Záloha JSON</button>
    </PageTitle>
    <div className="grid kpis">
      <Kpi label="Dnešní směny" value={todayShifts.length} hint={`${todayShifts.filter((shift) => shift.status === 'confirmed').length} potvrzeno · ${todayShifts.filter((shift) => shift.status === 'completed').length} hotovo`} />
      <Kpi label="Čeká na reakci" value={waiting.length} hint="Budoucí návrh / čeká na potvrzení" />
      <Kpi label="Běží směny" value={running.length} hint="Nástup bez ukončení" kind={running.length ? 'warn' : ''} />
      <Kpi label="Kolize" value={conflicts.length} hint={conflicts.length ? 'Nutná kontrola' : 'Bez zásahu'} kind={conflicts.length ? 'bad' : 'good'} />
      <Kpi label="Výměny / obsazení" value={pendingSwaps.length + gaps.length} hint={`${pendingSwaps.length} výměn · ${gaps.length} děr`} kind={pendingSwaps.length + gaps.length ? 'bad' : 'good'} />
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Dnešní provoz</h3><span className="pill">{formatDate(today)}</span></div><ShiftTable shifts={todayShifts} data={data} helpers={helpers} commit={commit} compact ui={shiftTableUi} services={shiftTableServices} /></div>
      <div className="card"><div className="section-title"><h3>Priorita k řešení</h3><span className={priorityCount ? 'pill bad' : 'pill good'}>{priorityCount}</span></div><div className="stack">
        {conflicts.slice(0, 8).map((item, index) => <div className="alert bad" key={`c-${index}`}><b>{item.shift.date} {item.shift.start}–{item.shift.end}</b><br />{item.message}</div>)}
        {declined.slice(0, 5).map((shift) => <div className="alert bad" key={shift.id}><b>Odmítnuto: {formatDate(shift.date)} {shift.start}–{shift.end}</b><br />{helpers.driverName(shift.driverId)} · {shift.declineReason || 'bez důvodu'}</div>)}
        {pendingSwaps.slice(0, 5).map((request) => {
          const shift = data.shifts.find((item) => item.id === request.shiftId)
          return <div className="alert warn" key={request.id}><b>Žádost o výměnu: {shift ? `${formatDate(shift.date)} ${shift.start}–${shift.end}` : 'směna'}</b><br />{helpers.driverName(request.driverId)} · {request.reason || 'bez důvodu'}</div>
        })}
        {gaps.slice(0, 5).map((gap) => <div className="alert warn" key={gap.day + gap.id}><b>Chybí obsazení: {formatDate(gap.day)} {gap.name}</b><br />{gap.start}–{gap.end} · chybí {gap.missing}</div>)}
        {!conflicts.length && !declined.length && !pendingSwaps.length && !gaps.length && <div className="empty">Bez konfliktů, odmítnutých směn a děr v obsazení.</div>}
      </div></div>
    </div>
    <div className="grid three" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Čeká na potvrzení</h3><span className="pill warn">{waiting.length}</span></div><div className="quick-list">{waiting.slice(0, 8).map((shift) => <QuickShift key={shift.id} shift={shift} helpers={helpers} StatusPill={StatusPill} />)}{!waiting.length && <div className="empty">Nic nečeká.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Volná auta dnes</h3><span className="pill good">{freeCars.length}</span></div><div className="quick-list">{freeCars.map((vehicle) => <div className="quick-item" key={vehicle.id}><div><strong>{vehicle.name}</strong><small>{vehicle.plate}</small></div><span className="pill good">volné</span></div>)}{!freeCars.length && <div className="empty">Všechna aktivní auta jsou dnes v plánu.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Volní řidiči dnes</h3><span className="pill good">{freeDrivers.length}</span></div><div className="quick-list">{freeDrivers.map((driver) => <div className="quick-item" key={driver.id}><div><strong>{driver.name}</strong><small>{driver.phone || driver.email || 'bez kontaktu'}</small></div><span className="pill good">volný</span></div>)}{!freeDrivers.length && <div className="empty">Všichni aktivní řidiči jsou dnes v plánu.</div>}</div></div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Zítra</h3><span className="pill">{tomorrowShifts.length} směn</span></div><pre className="copybox">{dayText(data, helpers, tomorrow)}</pre></div>
      <div className="card"><div className="section-title"><h3>Servis / nepřítomnosti</h3><span className="pill warn">{data.serviceBlocks.length + data.absences.length}</span></div><div className="stack">
        {data.serviceBlocks.slice(0, 4).map((service) => <div className="alert warn" key={service.id}>{helpers.vehicleName(service.vehicleId)} · {service.from} až {service.to}<br /><small>{service.reason}</small></div>)}
        {data.absences.slice(0, 4).map((absence) => <div className="alert warn" key={absence.id}>{helpers.driverName(absence.driverId)} · {absence.from} až {absence.to}<br /><small>{absence.reason}</small></div>)}
        {!data.serviceBlocks.length && !data.absences.length && <div className="empty">Bez blokací.</div>}
      </div></div>
    </div>
  </>
}

function QuickShift({ shift, helpers, StatusPill }) {
  return <div className="quick-item"><div><strong>{formatDate(shift.date)} {shift.start}–{shift.end}</strong><small>{helpers.driverName(shift.driverId)} · {helpers.vehicleName(shift.vehicleId)}</small></div><StatusPill status={shift.status} helpers={helpers} /></div>
}
