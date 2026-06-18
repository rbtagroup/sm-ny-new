import { useEffect, useState } from 'react'
import {
  actualDurationMinutes,
  addDays,
  durationLabel,
  formatDate,
  localStamp,
  startOfWeek,
  todayISO,
} from './lib/dateTime.js'
import { addNotificationsToData } from './lib/notifications.js'
import { canOpenSettlement, settlementForShift } from './lib/settlements.js'
import { repeatMap, shiftTypeMap, statusMap } from './lib/appConfig.js'
import {
  activeSwapForShift,
  calendarDriverLabel,
  calendarShiftLineClass,
  shiftNoticeBody,
  sortByDateTime,
} from './lib/display.js'
import {
  configuredShiftTimes,
  normalizeShiftTemplates,
  shiftTemplateOptions,
  shiftTemplateValue,
} from './lib/shiftTemplates.js'
import { coverageGaps } from './lib/opsMetrics.js'
import { SettlementFormModal } from './SettlementFormModal.jsx'
import { ShiftTable } from './StaffShiftTable.jsx'

const swapStatusMap = { pending: 'Nabídnuto', accepted: 'Přijato kolegou', approved: 'Schváleno', rejected: 'Zamítnuto', cancelled: 'Zrušeno řidičem' }

const blankShift = (date = todayISO(), settings = {}) => {
  const firstTemplate = normalizeShiftTemplates(settings).find((tpl) => tpl.active)
  const preset = firstTemplate ? shiftTemplateValue(firstTemplate.id, settings) : null
  const times = configuredShiftTimes(settings)
  return {
    date,
    start: preset?.start || times.dayStart,
    end: preset?.end || times.dayEnd,
    driverId: '',
    vehicleId: '',
    type: preset?.type || 'day',
    status: 'assigned',
    note: '',
    instruction: '',
    declineReason: '',
    actualStartAt: '',
    actualEndAt: '',
    swapRequestStatus: '',
  }
}

function PlannerKpiBar({ periodLabel, totalShifts, confirmedCount, conflictsCount, gapsCount, gapsOpen, conflictsOnly, onShowTable, onToggleConflicts, onToggleGaps }) {
  return <div className="planner-kpi-bar" aria-label="Souhrn plánu směn">
    <div className="planner-kpi-context"><span>📅</span><b>{periodLabel}</b></div>
    {totalShifts > 0 && <button type="button" className="planner-kpi-item" onClick={onShowTable}><b>{totalShifts}</b><span>směn</span></button>}
    {confirmedCount > 0 && <div className="planner-kpi-item passive"><b>{confirmedCount}</b><span>potvrzeno</span></div>}
    {conflictsCount > 0 && <button type="button" className={`planner-kpi-item danger ${conflictsOnly ? 'active' : ''}`} onClick={onToggleConflicts}><b>⚠ {conflictsCount}</b><span>kolize</span></button>}
    {gapsCount > 0 && <div className="planner-kpi-item missing"><b>{gapsCount}</b><span>chybí</span><button type="button" onClick={onToggleGaps}>{gapsOpen ? 'Sbalit ▴' : 'Rozbalit ▾'}</button></div>}
    {conflictsOnly && <button type="button" className="planner-kpi-reset" onClick={onToggleConflicts}>Zrušit filtr kolizí</button>}
  </div>
}

function ShiftForm({ data, helpers, commit, initialDate, editing, setEditing, onSaved, onCancel, onDirtyChange, variant = 'card', ui, services }) {
  const { Field, Select, ConflictBox, ConfirmActionModal, ShiftActionSummary } = ui
  const { uid, makeNotice, isPastLocked } = services
  const [form, setForm] = useState(blankShift(initialDate, data.settings))
  const [repeat, setRepeat] = useState('none')
  const [template, setTemplate] = useState('custom')
  const [override, setOverride] = useState(false)
  const [pastSaveDialogOpen, setPastSaveDialogOpen] = useState(false)

  useEffect(() => { if (!editing) setForm((current) => ({ ...current, date: initialDate })) }, [initialDate, editing])
  useEffect(() => {
    if (editing) {
      setForm({ ...blankShift(undefined, data.settings), ...editing })
      setRepeat('none')
      setTemplate('custom')
      setOverride(false)
    }
  }, [editing, data.settings])
  useEffect(() => {
    if (!onDirtyChange) return
    const baseline = editing ? { ...blankShift(undefined, data.settings), ...editing } : blankShift(initialDate, data.settings)
    const isDirty = JSON.stringify(form) !== JSON.stringify(baseline) || repeat !== 'none' || template !== 'custom' || override
    onDirtyChange(isDirty)
  }, [form, repeat, template, override, editing, initialDate, data.settings, onDirtyChange])

  const applyTemplate = (key) => {
    setTemplate(key)
    if (key === 'custom') return
    const preset = shiftTemplateValue(key, data.settings)
    if (preset) setForm((prev) => ({ ...prev, ...preset }))
  }
  const normalizeShiftForm = (item) => ({ ...item, status: !item.driverId ? 'open' : (item.status === 'open' ? 'assigned' : item.status) })
  const conflictMessages = helpers.conflictMessages({ id: editing?.id || 'new', ...normalizeShiftForm(form) })
  const buildRepeats = () => {
    if (editing || repeat === 'none') return [form]
    if (repeat === 'daily7') return Array.from({ length: 7 }, (_, index) => ({ ...form, date: addDays(form.date, index) }))
    if (repeat === 'workweek') return Array.from({ length: 5 }, (_, index) => ({ ...form, date: addDays(startOfWeek(form.date), index) }))
    if (repeat === 'weekend') return [5, 6].map((index) => ({ ...form, date: addDays(startOfWeek(form.date), index) }))
    return [form]
  }
  const saveShift = () => {
    const normalizedForm = normalizeShiftForm(form)
    const wasEditing = Boolean(editing)
    if (editing) {
      const notice = normalizedForm.status === 'open'
        ? makeNotice({ title: 'Volná směna upravena', body: shiftNoticeBody(normalizedForm, helpers), targetRole: 'driver_all', type: 'open-shift-change', shiftId: editing.id })
        : makeNotice({ title: 'Změna směny', body: shiftNoticeBody(normalizedForm, helpers), targetDriverId: normalizedForm.driverId, type: 'shift-change', shiftId: editing.id })
      commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((item) => item.id === editing.id ? { ...item, ...normalizedForm } : item) }, notice), `Upravena směna ${normalizedForm.date} ${normalizedForm.start}–${normalizedForm.end}.`)
    } else {
      const items = buildRepeats().map((item) => ({ id: uid('sh'), ...normalizeShiftForm(item) }))
      const notices = items.map((item) => item.status === 'open'
        ? makeNotice({ title: 'Nová volná směna', body: shiftNoticeBody(item, helpers, 'můžeš se přihlásit'), targetRole: 'driver_all', type: 'open-shift', shiftId: item.id })
        : makeNotice({ title: 'Nová směna', body: shiftNoticeBody(item, helpers), targetDriverId: item.driverId, type: 'new-shift', shiftId: item.id }))
      commit((prev) => addNotificationsToData({ ...prev, shifts: [...items, ...prev.shifts] }, notices), `Vytvořeno směn: ${items.length}.`)
    }
    setForm(blankShift(form.date, data.settings))
    setRepeat('none')
    setTemplate('custom')
    setOverride(false)
    setEditing(null)
    onSaved?.({ editing: wasEditing })
  }
  const submit = (event) => {
    event.preventDefault()
    if (!form.date || !form.start || !form.end) return alert('Vyplň datum a čas směny.')
    if (conflictMessages.length && !override) return alert('Směna má kolizi. Buď ji oprav, nebo zaškrtni uložení i s kolizí.')
    if (editing && isPastLocked(editing)) {
      setPastSaveDialogOpen(true)
      return
    }
    saveShift()
  }

  return <div className={variant === 'drawer' ? 'shift-form-panel' : 'card sticky-card'}>
    {variant !== 'drawer' && <div className="section-title"><h3>{editing ? 'Upravit směnu' : 'Nová směna'}</h3>{editing && <button className="ghost" onClick={() => { setEditing(null); setForm(blankShift(initialDate, data.settings)) }}>Zrušit</button>}</div>}
    {editing && isPastLocked(editing) && <div className="alert warn" style={{ marginBottom: 12 }}>Minulá směna: úprava bude vyžadovat potvrzení.</div>}
    <form className="form two-col" onSubmit={submit}>
      <Field label="Šablona směny" className="span2"><Select value={template} onChange={applyTemplate} options={shiftTemplateOptions(data.settings)} /></Field>
      <Field label="Datum"><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
      <Field label="Typ"><Select value={form.type} onChange={(value) => setForm({ ...form, type: value })} options={shiftTypeMap} /></Field>
      <Field label="Začátek"><input type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></Field>
      <Field label="Konec"><input type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></Field>
      <Field label="Řidič" className="span2"><select value={form.driverId} onChange={(event) => setForm({ ...form, driverId: event.target.value })}><option value="">Volná směna bez řidiče</option>{data.drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}{!driver.active ? ' · neaktivní' : ''}</option>)}</select></Field>
      <Field label="Vozidlo" className="span2"><select value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}><option value="">Bez vozu / doplnit později</option>{data.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.plate}{!vehicle.active ? ' · neaktivní' : ''}</option>)}</select></Field>
      <Field label="Stav"><Select value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={statusMap} /></Field>
      {!editing && <Field label="Opakování" className="span2"><Select value={repeat} onChange={setRepeat} options={repeatMap} /></Field>}
      <Field label="Poznámka pro plánovač" className="span2"><textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Např. letiště, záloha, firemní akce…" /></Field>
      <Field label="Instrukce pro řidiče" className="span2"><textarea value={form.instruction || ''} onChange={(event) => setForm({ ...form, instruction: event.target.value })} placeholder="Např. auto musí být čisté, bere terminál, SHKM, přesný čas odjezdu…" /></Field>
      {conflictMessages.length > 0 && <label className="field span2" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} style={{ width: 18 }} />Uložit i s kolizí / mimo dostupnost</label>}
      <div className="field span2 drawer-form-actions"><button className="primary" type="submit">Uložit</button><button className="ghost" type="button" onClick={onCancel}>Zrušit</button></div>
    </form>
    <div style={{ marginTop: 14 }}><ConflictBox messages={conflictMessages} /></div>
    {pastSaveDialogOpen && <ConfirmActionModal
      title="Upravit minulou směnu?"
      message="Tahle směna je v minulosti. Změna se uloží do historie a může ovlivnit docházku nebo výčetku."
      warning="Pokračuj jen pokud chceš zpětně upravit už proběhlou směnu."
      confirmLabel="Uložit změny"
      onClose={() => setPastSaveDialogOpen(false)}
      onConfirm={() => {
        setPastSaveDialogOpen(false)
        saveShift()
      }}
    >
      <ShiftActionSummary shift={editing} helpers={helpers} />
    </ConfirmActionModal>}
  </div>
}

export function Planner({ data, helpers, commit, today = todayISO(), ui, services }) {
  const { PageTitle, SideDrawer, ConfirmActionModal } = ui
  const { uid, copyText, weekText, shiftTableUi, shiftTableServices } = services
  const [weekStart, setWeekStart] = useState(startOfWeek(today))
  const [editing, setEditing] = useState(null)
  const [selected, setSelected] = useState(null)
  const [driverFilter, setDriverFilter] = useState('all')
  const [vehicleFilter, setVehicleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [gapsOpen, setGapsOpen] = useState(() => {
    try { return localStorage.getItem('rbshift-planner-gaps-open') === 'true' }
    catch { return false }
  })
  const [plannerView, setPlannerView] = useState('calendar')
  const [conflictsOnly, setConflictsOnly] = useState(false)
  const [shiftDrawerOpen, setShiftDrawerOpen] = useState(false)
  const [shiftFormDirty, setShiftFormDirty] = useState(false)
  const [closeDirtyDialogOpen, setCloseDirtyDialogOpen] = useState(false)
  const [plannerToast, setPlannerToast] = useState('')
  const rangeEnd = addDays(weekStart, 13)
  const initialShiftDate = today >= weekStart && today <= rangeEnd ? today : weekStart
  const rangeAll = sortByDateTime(data.shifts.filter((shift) => shift.date >= weekStart && shift.date <= rangeEnd))
  const rangeShifts = rangeAll.filter((shift) => {
    const byDriver = driverFilter === 'all' || shift.driverId === driverFilter
    const byVehicle = vehicleFilter === 'all' || shift.vehicleId === vehicleFilter
    const byStatus = statusFilter === 'all' || (statusFilter === 'active' ? !['cancelled', 'declined'].includes(shift.status) : shift.status === statusFilter)
    return byDriver && byVehicle && byStatus
  })
  const conflicts = rangeAll.flatMap((shift) => helpers.conflictMessages(shift).map((message) => ({ shift, message })))
  const gaps = [...coverageGaps(data, weekStart), ...coverageGaps(data, addDays(weekStart, 7))]
  const visibleShifts = conflictsOnly ? rangeShifts.filter((shift) => helpers.conflictMessages(shift).length > 0) : rangeShifts
  const confirmedCount = rangeShifts.filter((shift) => ['confirmed', 'completed'].includes(shift.status)).length
  useEffect(() => {
    try { localStorage.setItem('rbshift-planner-gaps-open', String(gapsOpen)) }
    catch { }
  }, [gapsOpen])
  useEffect(() => {
    setWeekStart((current) => today < current || today > addDays(current, 13) ? startOfWeek(today) : current)
  }, [today])
  useEffect(() => {
    if (!plannerToast) return undefined
    const timer = setTimeout(() => setPlannerToast(''), 2800)
    return () => clearTimeout(timer)
  }, [plannerToast])
  const openNewShiftDrawer = () => {
    setEditing(null)
    setShiftFormDirty(false)
    setShiftDrawerOpen(true)
  }
  const openEditShiftDrawer = (shift) => {
    setEditing(shift)
    setShiftFormDirty(false)
    setShiftDrawerOpen(true)
  }
  const closeShiftDrawer = () => {
    setShiftDrawerOpen(false)
    setEditing(null)
    setShiftFormDirty(false)
  }
  const requestCloseShiftDrawer = () => {
    if (shiftFormDirty) {
      setCloseDirtyDialogOpen(true)
      return
    }
    closeShiftDrawer()
  }
  const handleShiftSaved = ({ editing: wasEditing } = {}) => {
    closeShiftDrawer()
    setPlannerToast(wasEditing ? 'Směna upravena.' : 'Směna vytvořena.')
  }
  const copyWeek = () => {
    const nextItems = rangeShifts.map((shift) => ({ ...shift, id: uid('sh'), date: addDays(shift.date, 14), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }))
    if (!nextItems.length) return alert('Ve zobrazeném období nejsou žádné směny ke kopírování.')
    commit((prev) => ({ ...prev, shifts: [...nextItems, ...prev.shifts] }), `Zkopírováno zobrazené období na další 2 týdny: ${nextItems.length} směn.`)
    setWeekStart(addDays(weekStart, 14))
  }
  const copyToday = (date) => {
    const items = data.shifts.filter((shift) => shift.date === date).map((shift) => ({ ...shift, id: uid('sh'), date: addDays(date, 1), status: 'draft', declineReason: '', actualStartAt: '', actualEndAt: '', swapRequestStatus: '' }))
    if (!items.length) return alert('V daném dni nejsou žádné směny.')
    commit((prev) => ({ ...prev, shifts: [...items, ...prev.shifts] }), `Zkopírován den ${date} na další den.`)
  }
  const weeks = [weekStart, addDays(weekStart, 7)]

  return <>
    <PageTitle title="Plán směn">
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, -14))}>← Předchozí</button>
      <button className="ghost" onClick={() => setWeekStart(startOfWeek(today))}>Dnes</button>
      <button className="ghost" onClick={() => setWeekStart(addDays(weekStart, 14))}>Další →</button>
      <button className="primary" onClick={openNewShiftDrawer}>+ Nová směna</button>
      <button className="primary" onClick={copyWeek}>Kopírovat 2 týdny</button>
      <button className="ghost" onClick={() => copyText(weekText({ ...data, shifts: rangeShifts }, helpers, weekStart, 14))}>WhatsApp</button>
    </PageTitle>
    <PlannerKpiBar
      periodLabel={`${formatDate(weekStart)}–${formatDate(rangeEnd)}`}
      totalShifts={rangeShifts.length}
      confirmedCount={confirmedCount}
      conflictsCount={conflicts.length}
      gapsCount={gaps.length}
      gapsOpen={gapsOpen}
      conflictsOnly={conflictsOnly}
      onShowTable={() => { setConflictsOnly(false); setPlannerView('table') }}
      onToggleConflicts={() => { setConflictsOnly((value) => !value); setPlannerView('calendar') }}
      onToggleGaps={() => setGapsOpen((value) => !value)}
    />
    {gaps.length > 0 && gapsOpen && <div className="card planner-kpi-detail">
      <div className="section-title"><h3>Chybí obsazení</h3><span className="pill bad">{gaps.length}</span></div>
      <div className="table-wrap missing-coverage-table"><table className="table"><thead><tr><th>Datum</th><th>Čas</th><th>Typ směny</th><th>Stav</th><th>Akce</th></tr></thead><tbody>{gaps.map((gap) => <tr key={gap.day + gap.id}><td><b>{formatDate(gap.day)}</b><br /><small>{gap.day}</small></td><td>{gap.start}–{gap.end}</td><td>{gap.name}</td><td><span className="pill bad">chybí {gap.missing}</span><br /><small>plánováno {gap.planned} z {gap.minDrivers}</small></td><td><button className="ghost" type="button" onClick={() => { setPlannerView('calendar'); setShiftDrawerOpen(true); setShiftFormDirty(false); setEditing(null) }}>Vytvořit směnu</button></td></tr>)}</tbody></table></div>
      <div className="missing-coverage-mobile-list">
        {gaps.map((gap) => <div className="missing-coverage-card" key={gap.day + gap.id}>
          <div>
            <b>{formatDate(gap.day)} · {gap.start}–{gap.end}</b>
            <span>{gap.name}</span>
          </div>
          <span className="pill bad">chybí {gap.missing}</span>
          <small>Plánováno {gap.planned} z {gap.minDrivers}</small>
          <button className="ghost" type="button" onClick={() => { setPlannerView('calendar'); setShiftDrawerOpen(true); setShiftFormDirty(false); setEditing(null) }}>Vytvořit směnu</button>
        </div>)}
      </div>
    </div>}
    <div className="card compact-card" style={{ marginBottom: 16 }}>
      <div className="section-title"><h3>Filtry</h3></div>
      <div className="planner-filter">
        <select className="searchbox" value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}><option value="all">Všichni řidiči</option>{data.drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select>
        <select className="searchbox" value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)}><option value="all">Všechna auta</option>{data.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.plate}</option>)}</select>
        <select className="searchbox" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="active">Aktivní</option><option value="all">Všechny stavy</option>{Object.entries(statusMap).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      </div>
    </div>
    <div className="planner-main-grid">
      <div className="grid stack minzero">
        {selected && plannerView === 'calendar' && <ShiftDetail shift={selected} data={data} helpers={helpers} commit={commit} setSelected={setSelected} setEditing={openEditShiftDrawer} ui={ui} services={services} />}
        {plannerView === 'table' ? <div className="card calendar-card">
          <div className="section-title"><h3>Tabulka směn</h3><button className="ghost" type="button" onClick={() => setPlannerView('calendar')}>Zpět na kalendář</button></div>
          <ShiftTable shifts={rangeShifts} data={data} helpers={helpers} commit={commit} ui={shiftTableUi} services={shiftTableServices} />
        </div> : <div className="card calendar-card">
          <div className="section-title"><h3>Kalendář směn</h3>{conflictsOnly && <span className="pill bad">Filtr: kolize</span>}</div>
          <div className="two-week-calendar">
            {weeks.map((weekStartDate, index) => {
              const weekDays = Array.from({ length: 7 }, (_, dayIndex) => addDays(weekStartDate, dayIndex))
              return <div className="week-block" key={weekStartDate}>
                <div className="week-block-title"><b>{index + 1}. týden</b><span>{formatDate(weekStartDate)}–{formatDate(addDays(weekStartDate, 6))}</span></div>
                <div className="week-grid">
                  {weekDays.map((day) => <DayColumn key={day} day={day} today={today} shifts={visibleShifts} data={data} helpers={helpers} setSelected={setSelected} copyDay={copyToday} />)}
                </div>
              </div>
            })}
          </div>
        </div>}
      </div>
    </div>
    <SideDrawer title={editing ? 'Upravit směnu' : 'Nová směna'} open={shiftDrawerOpen} onClose={requestCloseShiftDrawer}>
      <ShiftForm
        data={data}
        helpers={helpers}
        commit={commit}
        initialDate={initialShiftDate}
        editing={editing}
        setEditing={setEditing}
        onSaved={handleShiftSaved}
        onCancel={requestCloseShiftDrawer}
        onDirtyChange={setShiftFormDirty}
        variant="drawer"
        ui={ui}
        services={services}
      />
    </SideDrawer>
    {closeDirtyDialogOpen && <ConfirmActionModal
      title="Zavřít bez uložení?"
      message="Formulář má neuložené změny. Po zavření se rozepsaná směna zahodí."
      confirmLabel="Zavřít bez uložení"
      confirmClass="danger"
      onClose={() => setCloseDirtyDialogOpen(false)}
      onConfirm={() => {
        setCloseDirtyDialogOpen(false)
        closeShiftDrawer()
      }}
    />}
    {plannerToast && <div className="planner-toast" role="status">{plannerToast}</div>}
  </>
}

function DayColumn({ day, today, shifts, data, helpers, setSelected, copyDay }) {
  const items = sortByDateTime(shifts.filter((shift) => shift.date === day))
  const copyThisDay = () => copyDay(day)
  const handleDayContextMenu = (event) => {
    if (event.target.closest?.('.calendar-shift-card')) return
    event.preventDefault()
    copyThisDay()
  }
  return <div className={`day ${day === today ? 'today' : ''}`} onContextMenu={handleDayContextMenu}>
    <h4>
      <span>{formatDate(day)}</span>
      <details className="day-menu" onClick={(event) => event.stopPropagation()}>
        <summary aria-label="Akce dne">⋯</summary>
        <div className="day-menu-panel">
          <button type="button" onClick={copyThisDay}>Kopírovat den</button>
        </div>
      </details>
    </h4>
    <span className="mobile-day-head">{items.length ? `${items.length} směn` : 'volno'}</span>
    {items.map((shift) => <ShiftMini key={shift.id} shift={shift} data={data} helpers={helpers} setSelected={setSelected} />)}
    {!items.length && <div className="empty calendar-empty">Bez směn</div>}
  </div>
}

function ShiftMini({ shift, data, helpers, setSelected }) {
  const conflicts = helpers.conflictMessages(shift)
  const activeSwap = activeSwapForShift(shift, data)
  const driverLabel = calendarDriverLabel(shift.driverId, data, helpers)
  const lineClass = calendarShiftLineClass(shift, conflicts, activeSwap)
  const conflictLabel = conflicts.length === 1 ? '⚠ kolize' : `⚠ ${conflicts.length} kolize`
  const swapLabel = activeSwap?.targetMode === 'open' ? 'zájemce čeká' : (activeSwap?.status === 'accepted' ? 'výměna přijata' : 'čeká výměna')
  const title = [`${shift.start} – ${shift.end}`, helpers.driverName(shift.driverId), activeSwap ? swapLabel : '', ...conflicts].filter(Boolean).join('\n')
  return <button
    type="button"
    className={`shift-card compact-shift calendar-shift-card ${lineClass} status-${shift.status}`}
    title={title}
    aria-label={title}
    onClick={() => setSelected(shift)}
  >
    <span className="calendar-shift-time">{shift.start} – {shift.end}</span>
    <span className="calendar-shift-driver">{driverLabel}</span>
    {conflicts.length > 0 && <span className="calendar-shift-conflict">{conflictLabel}</span>}
    {!conflicts.length && activeSwap && <span className="calendar-shift-swap">{swapLabel}</span>}
  </button>
}

function ShiftDetail({ shift, data, helpers, commit, setSelected, setEditing, ui, services }) {
  const {
    Kpi,
    SettlementStatusPill,
    SettlementSummary,
    ConflictBox,
    DeleteIconButton,
    ReasonActionModal,
    ShiftActionSummary,
    ConfirmActionModal,
  } = ui
  const {
    adminNotice,
    makeNotice,
    appendSwapHistory,
    statusNoticeForShift,
    hardDeleteShiftData,
    copyText,
    driverText,
    isPastLocked,
    settlementFormUi,
    settlementFormServices,
  } = services
  const [settlementOpen, setSettlementOpen] = useState(false)
  const [actionDialog, setActionDialog] = useState(null)
  const fresh = data.shifts.find((item) => item.id === shift.id) || shift
  const conflicts = helpers.conflictMessages(fresh)
  const swaps = (data.swapRequests || []).filter((request) => request.shiftId === fresh.id)
  const settlement = settlementForShift(data, fresh.id)
  const duration = actualDurationMinutes(fresh)
  const closeActionDialog = () => setActionDialog(null)
  const commitStatus = (status, reason = fresh.declineReason || '') => {
    commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((item) => item.id === fresh.id ? { ...item, status, declineReason: reason } : item) }, statusNoticeForShift({ ...fresh, status, declineReason: reason }, status, helpers, reason)), `Detail směny: stav změněn na ${statusMap[status]}.`)
  }
  const requestStatus = (status, reason = fresh.declineReason || '') => {
    if (status === 'declined') {
      setActionDialog({ type: 'decline', status, reason })
      return
    }
    if (isPastLocked(fresh)) {
      setActionDialog({ type: 'status', status, reason })
      return
    }
    commitStatus(status, reason)
  }
  const confirmStatusAction = () => {
    if (!actionDialog?.status) return
    commitStatus(actionDialog.status, actionDialog.reason || '')
    closeActionDialog()
  }
  const requestEdit = () => {
    if (isPastLocked(fresh)) {
      setActionDialog({ type: 'editPast' })
      return
    }
    setEditing(fresh)
  }
  const confirmEdit = () => {
    closeActionDialog()
    setEditing(fresh)
  }
  const checkIn = () => commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((item) => item.id === fresh.id ? { ...item, actualStartAt: item.actualStartAt || localStamp(), status: item.status === 'assigned' ? 'confirmed' : item.status } : item) }, adminNotice('Řidič nastoupil na směnu', `${helpers.driverName(fresh.driverId)} · ${shiftNoticeBody(fresh, helpers)}`, 'attendance-start', fresh.id)), 'V detailu směny zaznamenán nástup.')
  const checkOut = () => commit((prev) => addNotificationsToData({ ...prev, shifts: prev.shifts.map((item) => item.id === fresh.id ? { ...item, actualEndAt: item.actualEndAt || localStamp(), status: 'completed' } : item) }, adminNotice('Řidič ukončil směnu', `${helpers.driverName(fresh.driverId)} · ${shiftNoticeBody(fresh, helpers)}`, 'attendance-end', fresh.id)), 'V detailu směny zaznamenáno ukončení.')
  const requestHardDelete = () => setActionDialog({ type: 'hardDelete' })
  const confirmHardDelete = () => {
    commit((prev) => hardDeleteShiftData(prev, fresh), '')
    closeActionDialog()
    setSelected(null)
  }
  const resolveSwap = (id, status) => {
    const request = swaps.find((item) => item.id === id)
    if (!request) return
    if (status === 'approved') {
      const newDriverId = request.acceptedByDriverId || request.targetDriverId
      if (!newDriverId) return alert('U nabídky všem musí nejdřív některý kolega kliknout „Chci převzít směnu“.')
      const notices = request.targetMode === 'open'
        ? [makeNotice({ title: 'Volná směna schválena a potvrzena', body: shiftNoticeBody(fresh, helpers, 'směna je rovnou potvrzená'), targetDriverId: newDriverId, type: 'open-shift-approved', shiftId: fresh.id })]
        : [
          makeNotice({ title: 'Výměna směny schválena', body: `${shiftNoticeBody(fresh, helpers)} · převedeno na ${helpers.driverName(newDriverId)}`, targetDriverId: request.driverId, type: 'swap-approved', shiftId: fresh.id }),
          makeNotice({ title: 'Převzal jsi směnu – potvrzeno', body: shiftNoticeBody(fresh, helpers, 'směna je rovnou potvrzená'), targetDriverId: newDriverId, type: 'swap-approved', shiftId: fresh.id }),
        ]
      return commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((item) => item.id === id ? appendSwapHistory({ ...item, status, resolvedAt: new Date().toISOString(), approvedDriverId: newDriverId }, `Admin schválil převzetí pro ${helpers.driverName(newDriverId)}. Směna byla automaticky potvrzena.`) : item), shifts: prev.shifts.map((item) => item.id === fresh.id ? { ...item, driverId: newDriverId, status: 'confirmed', declineReason: '', swapRequestStatus: 'approved' } : item) }, notices), `${request.targetMode === 'open' ? 'Volná směna byla přidělena a potvrzena' : 'Výměna schválena, směna převedena a potvrzena pro'} ${helpers.driverName(newDriverId)}.`)
    }
    const notices = [makeNotice({ title: 'Výměna směny zamítnuta', body: shiftNoticeBody(fresh, helpers), targetDriverId: request.driverId, type: 'swap-rejected', shiftId: fresh.id })]
    if (request.acceptedByDriverId) notices.push(makeNotice({ title: 'Výměna nebyla schválena', body: shiftNoticeBody(fresh, helpers), targetDriverId: request.acceptedByDriverId, type: 'swap-rejected', shiftId: fresh.id }))
    commit((prev) => addNotificationsToData({ ...prev, swapRequests: (prev.swapRequests || []).map((item) => item.id === id ? appendSwapHistory({ ...item, status, resolvedAt: new Date().toISOString(), rejectedReason: status === 'rejected' ? 'Zamítnuto adminem' : '' }, status === 'rejected' ? 'Admin zamítl výměnu.' : `Stav výměny změněn na ${swapStatusMap[status]}.`) : item), shifts: prev.shifts.map((item) => item.id === fresh.id ? { ...item, swapRequestStatus: status } : item) }, notices), `Žádost o výměnu směny: ${swapStatusMap[status]}.`)
  }

  return <>
    <div className="card detail-panel">
      <div className="section-title"><h3>Detail směny</h3><button className="ghost" onClick={() => setSelected(null)}>Zavřít</button></div>
      <div className="grid three">
        <Kpi label="Datum" value={formatDate(fresh.date)} hint={`${fresh.start}–${fresh.end}`} />
        <Kpi label="Řidič" value={helpers.driverName(fresh.driverId)} hint="Přiřazená osoba" />
        <Kpi label="Auto" value={helpers.vehicle(fresh.vehicleId)?.plate || '—'} hint={helpers.vehicle(fresh.vehicleId)?.name || 'Bez vozu'} />
      </div>
      <p className="muted">Typ: {shiftTypeMap[fresh.type]} · Poznámka: {fresh.note || 'bez poznámky'}</p>
      {fresh.instruction && <div className="alert good"><b>Instrukce pro řidiče:</b><br />{fresh.instruction}</div>}
      <div className="grid three" style={{ marginTop: 12 }}>
        <Kpi label="Nástup" value={fresh.actualStartAt ? new Date(fresh.actualStartAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} hint={fresh.actualStartAt ? new Date(fresh.actualStartAt).toLocaleDateString('cs-CZ') : 'nezadáno'} />
        <Kpi label="Konec" value={fresh.actualEndAt ? new Date(fresh.actualEndAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—'} hint={fresh.actualEndAt ? new Date(fresh.actualEndAt).toLocaleDateString('cs-CZ') : 'nezadáno'} />
        <Kpi label="Reálný čas" value={durationLabel(duration)} hint="check-in / check-out" />
      </div>
      {(canOpenSettlement(fresh) || settlement) && <div className="card-soft settlement-inline-card">
        <div className="split"><div><b>Výčetka</b><br /><small className="muted">Navázaná na ukončenou směnu</small></div><SettlementStatusPill settlement={settlement} /></div>
        <SettlementSummary settlement={settlement} />
        <div className="row-actions" style={{ marginTop: 10 }}><button onClick={() => setSettlementOpen(true)}>{settlement ? 'Otevřít výčetku' : 'Založit výčetku'}</button></div>
      </div>}
      {fresh.declineReason && <div className="alert bad"><b>Důvod odmítnutí:</b><br />{fresh.declineReason}</div>}
      {swaps.length > 0 && <div className="card-soft"><h4>Žádosti / zájemci</h4><div className="stack">{swaps.map((request) => <div className="alert warn" key={request.id}><b>{request.targetMode === 'open' ? 'Zájem o volnou směnu' : swapStatusMap[request.status]}</b> · {new Date(request.createdAt).toLocaleString('cs-CZ')}<br />Od: {helpers.driverName(request.driverId)} · Komu: {request.targetMode === 'open' ? 'volná směna' : (request.targetMode === 'driver' ? helpers.driverName(request.targetDriverId) : 'všem kolegům')}{request.acceptedByDriverId && <><br />Přijal: <b>{helpers.driverName(request.acceptedByDriverId)}</b></>}{request.approvedDriverId && <><br />Schválený řidič: <b>{helpers.driverName(request.approvedDriverId)}</b></>}{request.rejectedReason && <><br />Důvod zamítnutí: {request.rejectedReason}</>}<br />{request.reason || 'Bez důvodu'}{request.history?.length ? <div className="swap-history">{request.history.map((historyItem, index) => <small key={index}>{new Date(historyItem.at).toLocaleString('cs-CZ')} · {historyItem.text}</small>)}</div> : null}{['pending','accepted'].includes(request.status) && <div className="row-actions" style={{ marginTop: 8 }}><button onClick={() => resolveSwap(request.id, 'approved')}>Schválit a potvrdit</button><button onClick={() => resolveSwap(request.id, 'rejected')}>Zamítnout</button></div>}</div>)}</div></div>}
      <div style={{ marginTop: 12 }}><ConflictBox messages={conflicts} /></div>
      <div className="actions" style={{ marginTop: 14, justifyContent: 'flex-start' }}>
        <button className="primary" onClick={() => requestStatus('confirmed')}>Potvrdit</button>
        <button className="ghost" onClick={checkIn}>Nástup</button>
        <button className="ghost" onClick={checkOut}>Ukončit</button>
        <button className="ghost" onClick={() => setSettlementOpen(true)} disabled={!canOpenSettlement(fresh) && !settlement}>Výčetka</button>
        <button className="ghost" onClick={() => requestStatus('completed')}>Dokončeno</button>
        <button className="danger" onClick={() => requestStatus('declined')}>Odmítnout</button>
        <button className="ghost" onClick={requestEdit}>Upravit</button>
        <button className="ghost" onClick={() => copyText(driverText(data, helpers, fresh.driverId))}>WhatsApp řidič</button>
        <DeleteIconButton className="detail-delete-button" label="Trvale odstranit směnu" onClick={requestHardDelete} />
      </div>
    </div>
    {settlementOpen && <SettlementFormModal data={data} helpers={helpers} commit={commit} shift={fresh} isDriver={false} onClose={() => setSettlementOpen(false)} ui={settlementFormUi} services={settlementFormServices} />}
    {actionDialog?.type === 'decline' && <ReasonActionModal
      title="Odmítnout směnu"
      message="Směna se označí jako odmítnutá a důvod zůstane viditelný v detailu."
      warning={isPastLocked(fresh) ? 'Tahle směna je v minulosti. Změna ovlivní historii směny.' : ''}
      label="Důvod odmítnutí"
      reason={actionDialog.reason}
      placeholder="Např. kolize, nemoc nebo provozní důvod."
      confirmLabel="Odmítnout směnu"
      confirmClass="danger"
      onReasonChange={(reason) => setActionDialog((current) => current ? { ...current, reason } : current)}
      onClose={closeActionDialog}
      onConfirm={confirmStatusAction}
    >
      <ShiftActionSummary shift={fresh} helpers={helpers} />
    </ReasonActionModal>}
    {actionDialog?.type === 'status' && <ConfirmActionModal
      title="Změnit minulou směnu?"
      message={`Stav směny se změní na „${statusMap[actionDialog.status] || actionDialog.status}”.`}
      warning="Tahle směna je v minulosti. Změna může ovlivnit historii, docházku nebo výčetku."
      confirmLabel="Změnit stav"
      onClose={closeActionDialog}
      onConfirm={confirmStatusAction}
    >
      <ShiftActionSummary shift={fresh} helpers={helpers} />
    </ConfirmActionModal>}
    {actionDialog?.type === 'editPast' && <ConfirmActionModal
      title="Upravit minulou směnu?"
      message="Otevře se formulář pro úpravu už proběhlé směny."
      warning="Pokračuj jen pokud chceš zpětně upravit historii směny."
      confirmLabel="Otevřít úpravu"
      onClose={closeActionDialog}
      onConfirm={confirmEdit}
    >
      <ShiftActionSummary shift={fresh} helpers={helpers} />
    </ConfirmActionModal>}
    {actionDialog?.type === 'hardDelete' && <ConfirmActionModal
      title="Trvale odstranit směnu"
      message="Tahle akce odstraní směnu z databáze, řidičské aplikace, související žádosti o výměnu, notifikace a navázané záznamy historie."
      warning="Řidiči se neposílá žádná další notifikace a akce nejde jednoduše vrátit."
      confirmLabel="Trvale odstranit"
      confirmClass="danger"
      onClose={closeActionDialog}
      onConfirm={confirmHardDelete}
    >
      <ShiftActionSummary shift={fresh} helpers={helpers} />
    </ConfirmActionModal>}
  </>
}
