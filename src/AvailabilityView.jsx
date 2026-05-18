import { useEffect, useState } from 'react'
import { datetimeLocal, timePart, todayISO } from './lib/dateTime.js'
import { uid } from './lib/ids.js'
import {
  availabilityKind,
  availabilityKindMap,
  availabilityKindTone,
  availabilityLabel,
  availabilityNoteText,
  availabilityRangeOverlaps,
} from './lib/availability.js'

const absenceDefaults = (driverId = '') => ({ driverId, from: todayISO(), to: todayISO(), reason: '' })
const availabilityDefaults = (driverId = '') => ({ driverId, kind: 'available', fromAt: datetimeLocal(todayISO(), '07:00'), toAt: datetimeLocal(todayISO(), '19:00'), note: '' })
const resetAbsenceDates = (absence) => ({ ...absence, from: todayISO(), to: todayISO(), reason: '' })
const resetAvailabilityDates = (slot) => ({ ...slot, fromAt: datetimeLocal(todayISO(), '07:00'), toAt: datetimeLocal(todayISO(), '19:00'), note: '' })

function DriverField({ Field, currentDriver, driversForSelect, value, onChange }) {
  if (currentDriver) return null
  return <Field label="Řidič"><select value={value} onChange={(event) => onChange(event.target.value)}>{driversForSelect.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></Field>
}

export function Availability({ data, commit, currentDriver, ui }) {
  const { ActionSummary, ConfirmActionModal, DeleteIconButton, Field, PageTitle } = ui
  const firstDriverId = currentDriver?.id || data.drivers.find((driver) => driver.active !== false)?.id || data.drivers[0]?.id || ''
  const [absence, setAbsence] = useState(() => absenceDefaults(firstDriverId))
  const [slot, setSlot] = useState(() => availabilityDefaults(firstDriverId))
  const [availabilityToast, setAvailabilityToast] = useState('')
  const [deleteDialog, setDeleteDialog] = useState(null)

  useEffect(() => {
    if (currentDriver?.id) {
      setAbsence((form) => ({ ...form, driverId: currentDriver.id }))
      setSlot((form) => ({ ...form, driverId: currentDriver.id }))
    }
  }, [currentDriver?.id])
  useEffect(() => {
    if (!availabilityToast) return undefined
    const timer = setTimeout(() => setAvailabilityToast(''), 4200)
    return () => clearTimeout(timer)
  }, [availabilityToast])

  const driversForSelect = currentDriver ? [currentDriver] : data.drivers.filter((driver) => driver.active !== false)
  const absences = data.absences.filter((item) => !currentDriver || item.driverId === currentDriver.id)
  const availability = (data.availability || []).filter((item) => !currentDriver || item.driverId === currentDriver.id)
  const deleteTarget = deleteDialog?.type === 'absence'
    ? data.absences.find((item) => item.id === deleteDialog.id)
    : deleteDialog?.type === 'slot'
      ? (data.availability || []).find((item) => item.id === deleteDialog.id)
      : null

  const submitAbsence = (event) => {
    event.preventDefault()
    if (!absence.driverId || !absence.from || !absence.to) return alert('Vyplň řidiče a datum.')
    if (absence.to < absence.from) return alert('Datum Do musí být stejné nebo pozdější než Od.')
    commit((prev) => ({ ...prev, absences: [{ id: uid('abs'), ...absence }, ...prev.absences] }), 'Přidána nepřítomnost řidiče.')
    setAbsence(resetAbsenceDates(absence))
  }
  const submitSlot = (event) => {
    event.preventDefault()
    if (!slot.driverId) return alert('Vyber řidiče.')
    if (!slot.fromAt || !slot.toAt) return alert('Vyplň datum a čas od/do.')
    if (new Date(slot.toAt) <= new Date(slot.fromAt)) return alert('Čas Do musí být později než Od.')
    const payload = {
      id: uid('av'),
      driverId: slot.driverId,
      fromAt: slot.fromAt,
      toAt: slot.toAt,
      date: '',
      weekday: '',
      start: timePart(slot.fromAt),
      end: timePart(slot.toAt),
      note: `[${slot.kind}] ${slot.note || ''}`.trim(),
    }
    const overlaps = (data.availability || []).filter((item) => item.driverId === slot.driverId && availabilityRangeOverlaps(item, payload))
    if (overlaps.length) setAvailabilityToast(`Pozor: překryv s ${overlaps.length} existující dostupností. Záznam byl přidán bez přepsání.`)
    commit((prev) => ({ ...prev, availability: [payload, ...(prev.availability || [])] }), 'Přidána dostupnost řidiče.')
    setSlot(resetAvailabilityDates(slot))
  }
  const requestDelete = (type, id) => {
    setDeleteDialog({ type, id })
  }
  const confirmDelete = () => {
    if (!deleteTarget || !deleteDialog) return
    if (deleteDialog.type === 'absence') {
      commit((prev) => ({ ...prev, absences: prev.absences.filter((item) => item.id !== deleteTarget.id) }), 'Nepřítomnost řidiče odstraněna.')
    } else {
      commit((prev) => ({ ...prev, availability: (prev.availability || []).filter((item) => item.id !== deleteTarget.id) }), 'Dostupnost řidiče odstraněna.')
    }
    setDeleteDialog(null)
  }
  const removeAbsence = (id) => requestDelete('absence', id)
  const removeSlot = (id) => requestDelete('slot', id)

  return <><PageTitle title="Dostupnost řidičů" />
    {availabilityToast && <div className="planner-toast" role="status">{availabilityToast}</div>}
    <div className="grid two">
      <div className="card"><div className="section-title"><h3>Nová dostupnost</h3><span className="pill">od–do</span></div><form className="form two-col" onSubmit={submitSlot}>
        <DriverField Field={Field} currentDriver={currentDriver} driversForSelect={driversForSelect} value={slot.driverId} onChange={(value) => setSlot({ ...slot, driverId: value })} />
        <Field label="Typ"><select value={slot.kind} onChange={(event) => setSlot({ ...slot, kind: event.target.value })}><option value="available">Dostupný</option><option value="unavailable">Nedostupný</option><option value="preferred">Preferuje</option></select></Field>
        <Field label="Od"><input type="datetime-local" value={slot.fromAt} onChange={(event) => setSlot({ ...slot, fromAt: event.target.value })} /></Field>
        <Field label="Do"><input type="datetime-local" value={slot.toAt} onChange={(event) => setSlot({ ...slot, toAt: event.target.value })} /></Field>
        <Field label="Poznámka" className="span2"><input value={slot.note} onChange={(event) => setSlot({ ...slot, note: event.target.value })} placeholder="Např. jen denní, po domluvě…" /></Field>
        <div className="field span2"><button className="primary" type="submit">Uložit dostupnost</button></div>
      </form></div>
      <div className="card"><h3>Nová nepřítomnost</h3><form className="form two-col" onSubmit={submitAbsence}>
        <DriverField Field={Field} currentDriver={currentDriver} driversForSelect={driversForSelect} value={absence.driverId} onChange={(value) => setAbsence({ ...absence, driverId: value })} />
        <Field label="Od"><input type="date" value={absence.from} onChange={(event) => setAbsence({ ...absence, from: event.target.value })} /></Field>
        <Field label="Do"><input type="date" value={absence.to} onChange={(event) => setAbsence({ ...absence, to: event.target.value })} /></Field>
        <Field label="Důvod" className="span2"><input value={absence.reason} onChange={(event) => setAbsence({ ...absence, reason: event.target.value })} placeholder="Volno, nemoc, dovolená…" /></Field>
        <div className="field span2"><button className="primary" type="submit">Uložit nepřítomnost</button></div>
      </form></div>
    </div>
    <div className="grid two" style={{ marginTop: 16 }}>
      <div className="card"><div className="section-title"><h3>Dostupnost</h3><span className="pill">{availability.length}</span></div><div className="stack compact-list">{availability.map((item) => {
        const kind = availabilityKind(item)
        const note = availabilityNoteText(item)
        return <div className={kind === 'unavailable' ? 'alert bad' : kind === 'preferred' ? 'alert warn' : 'alert good'} key={item.id}>
          <div className="split"><div><b>{data.drivers.find((driver) => driver.id === item.driverId)?.name}</b> · {availabilityLabel(item)}</div><span className={`pill ${availabilityKindTone[kind] || 'good'}`}>{availabilityKindMap[kind] || 'Dostupný'}</span></div>
          {note && <small>{note}</small>}
          <div className="row-actions" style={{ marginTop: 8 }}><DeleteIconButton label="Odstranit dostupnost" onClick={() => removeSlot(item.id)} /></div>
        </div>
      })}{!availability.length && <div className="empty">Není zadaná žádná dostupnost.</div>}</div></div>
      <div className="card"><div className="section-title"><h3>Nepřítomnosti</h3><span className="pill warn">{absences.length}</span></div><div className="stack compact-list">{absences.map((item) => <div className="alert warn" key={item.id}><b>{data.drivers.find((driver) => driver.id === item.driverId)?.name}</b> · {item.from} až {item.to}<br /><small>{item.reason || 'Bez důvodu'}</small><div className="row-actions" style={{ marginTop: 8 }}><DeleteIconButton label="Odstranit nepřítomnost" onClick={() => removeAbsence(item.id)} /></div></div>)}{!absences.length && <div className="empty">Žádné nepřítomnosti.</div>}</div></div>
    </div>
    {deleteTarget && <ConfirmActionModal
      title={deleteDialog.type === 'absence' ? 'Odstranit nepřítomnost' : 'Odstranit dostupnost'}
      message={deleteDialog.type === 'absence' ? 'Nepřítomnost se odstraní z plánování dostupnosti řidiče.' : 'Záznam dostupnosti se odstraní z plánování směn.'}
      confirmLabel={deleteDialog.type === 'absence' ? 'Odstranit nepřítomnost' : 'Odstranit dostupnost'}
      confirmClass="danger"
      onClose={() => setDeleteDialog(null)}
      onConfirm={confirmDelete}
    >
      <ActionSummary
        eyebrow={deleteDialog.type === 'absence' ? 'Nepřítomnost' : 'Dostupnost'}
        title={deleteDialog.type === 'absence' ? `${deleteTarget.from} až ${deleteTarget.to}` : availabilityLabel(deleteTarget)}
        meta={`${data.drivers.find((driver) => driver.id === deleteTarget.driverId)?.name || 'Řidič'} · ${deleteDialog.type === 'absence' ? (deleteTarget.reason || 'Bez důvodu') : (availabilityNoteText(deleteTarget) || availabilityKindMap[availabilityKind(deleteTarget)] || 'Dostupnost')}`}
      />
    </ConfirmActionModal>}
  </>
}
