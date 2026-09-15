import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { EARLIEST_PLAN_DATE, isPlausiblePlanDate, LATEST_PLAN_DATE } from './lib/dateTime.js'
import { showNotice } from './lib/notice.js'
import { dateRangeLabel } from './lib/display.js'
import { takeBackChange } from './lib/undo.js'

const emptyVehicleForm = Object.freeze({ name: '', plate: '', year: '', active: true, note: '' })
const freshVehicleForm = () => ({ ...emptyVehicleForm })
const freshServiceBlock = (todayISO) => ({ vehicleId: '', from: todayISO(), to: todayISO(), reason: '' })

const normalizePlate = (plate = '') => String(plate || '').toUpperCase().replace(/\s+/g, ' ').trim()
const isValidPlate = (plate = '') => {
  const value = normalizePlate(plate)
  return value.length >= 2 && value.length <= 16 && !/[^\p{L}\p{N} -]/u.test(value)
}
const extractVehicleYear = (note = '') => {
  const match = String(note || '').match(/^Rok výroby:\s*(\d{4})(?:\s*·\s*)?/)
  return match?.[1] || ''
}
const vehicleNoteBody = (note = '') => String(note || '').replace(/^Rok výroby:\s*\d{4}(?:\s*·\s*)?/, '').trim()
const composeVehicleNote = (year = '', note = '') => [year ? `Rok výroby: ${year}` : '', String(note || '').trim()].filter(Boolean).join(' · ')
const isValidVehicleYear = (year = '') => {
  if (!String(year || '').trim()) return true
  const value = Number(year)
  const current = new Date().getFullYear() + 1
  return Number.isInteger(value) && value >= 1990 && value <= current
}
const formFromVehicle = (vehicle = {}) => ({
  ...freshVehicleForm(),
  ...vehicle,
  year: extractVehicleYear(vehicle.note),
  note: vehicleNoteBody(vehicle.note),
  plate: vehicle.plate || '',
  name: vehicle.name || '',
  active: vehicle.active !== false,
})

export function Vehicles({ data, commit, services, ui }) {
  const { todayISO, uid } = services
  const { ActionSummary, ConfirmActionModal, Field, PageTitle, SideDrawer } = ui
  const [form, setForm] = useState(freshVehicleForm)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [openBlockId, setOpenBlockId] = useState('')
  const [block, setBlock] = useState(() => freshServiceBlock(todayISO))
  const editingVehicle = editing ? data.vehicles.find((vehicle) => vehicle.id === editing) : null
  const openBlock = openBlockId ? data.serviceBlocks.find((item) => item.id === openBlockId) : null
  const vehicleLabel = (vehicleId) => data.vehicles.find((vehicle) => vehicle.id === vehicleId)?.name || 'Vůz'
  const activeCount = data.vehicles.filter((vehicle) => vehicle.active !== false).length
  const closeDrawer = () => { setDrawerOpen(false); setEditing(null); setForm(freshVehicleForm()) }
  const openCreate = () => { setForm(freshVehicleForm()); setEditing(null); setDrawerOpen(true) }
  const openEdit = (vehicle) => {
    setForm(formFromVehicle(vehicle))
    setEditing(vehicle.id)
    setDrawerOpen(true)
  }
  const submit = (event) => {
    event.preventDefault()
    const name = form.name.trim()
    const plate = normalizePlate(form.plate)
    const year = String(form.year || '').trim()
    if (!name) return showNotice('Vyplň model vozidla.')
    if (!plate || !isValidPlate(plate)) return showNotice('Vyplň platnou SPZ. Použij 2–16 znaků: písmena, čísla, mezery nebo pomlčky.')
    if (!isValidVehicleYear(year)) return showNotice('Rok výroby musí být mezi 1990 a příštím rokem.')
    const payload = { name, plate, active: form.active !== false, note: composeVehicleNote(year, form.note) }
    if (editing) commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((vehicle) => vehicle.id === editing ? { ...vehicle, ...payload } : vehicle) }), 'Vozidlo upraveno.')
    else commit((prev) => ({ ...prev, vehicles: [{ id: uid('car'), ...payload }, ...prev.vehicles] }), 'Vozidlo vytvořeno.')
    closeDrawer()
  }
  const addBlock = (event) => {
    event.preventDefault()
    if (!block.vehicleId) return showNotice('Vyber vozidlo.')
    if (!isPlausiblePlanDate(block.from) || !isPlausiblePlanDate(block.to)) return showNotice('Zkontroluj datum blokace, rok musí být mezi 2020 a 2100.')
    commit((prev) => ({ ...prev, serviceBlocks: [{ id: uid('srv'), ...block }, ...prev.serviceBlocks] }), 'Přidána servisní blokace vozidla.')
    setBlock(freshServiceBlock(todayISO))
  }
  // A block is removed from its detail; the notice after it can still take the removal back.
  const removeBlock = () => {
    if (!openBlock) return
    const removed = openBlock
    const label = `${vehicleLabel(removed.vehicleId)} ${dateRangeLabel(removed.from, removed.to)}`
    commit((prev) => ({ ...prev, serviceBlocks: prev.serviceBlocks.filter((item) => item.id !== removed.id) }), `Servisní blokace odstraněna: ${label}.`)
    setOpenBlockId('')
    showNotice('Servisní blokace je odstraněná.', {
      tone: 'good',
      undo: () => commit((prev) => takeBackChange(prev, [{ key: 'serviceBlocks', before: [removed] }]), `Odstranění servisní blokace vráceno zpět: ${label}.`),
    })
  }
  // Taking a vehicle out of service keeps its history and can be taken back, so it asks nothing and offers "Vrátit zpět".
  const retire = (vehicle = editingVehicle) => {
    if (!vehicle) return
    const label = `${vehicle.name || 'Bez modelu'} · ${vehicle.plate || 'Bez SPZ'}`
    commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((item) => item.id === vehicle.id ? { ...item, active: false } : item) }), `Vozidlo ${label} vyřazeno.`)
    if (editing === vehicle.id) closeDrawer()
    showNotice(`Vozidlo ${label} je vyřazené. Nenabízí se do směn, historie zůstává.`, {
      tone: 'good',
      undo: () => commit((prev) => takeBackChange(prev, [{ key: 'vehicles', before: [vehicle] }]), `Vyřazení vozidla ${label} vráceno zpět.`),
    })
  }
  const restoreVehicle = (vehicle) => commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((item) => item.id === vehicle.id ? { ...item, active: true } : item) }), 'Vozidlo obnoveno.')

  return <>
    <PageTitle title="Vozidla"><button className="primary" onClick={openCreate}>+ Přidat vozidlo</button></PageTitle>
    <div className="grid two">
      <div className="card">
        <div className="section-title"><h3>Seznam vozidel</h3><span className="pill">{activeCount} aktivní / {data.vehicles.length} celkem</span></div>
        <div className="stack compact-list">{data.vehicles.map((vehicle) => {
          const year = extractVehicleYear(vehicle.note)
          const note = vehicleNoteBody(vehicle.note)
          return <div className="log list-row" key={vehicle.id}>
            <div className="list-row-main" role="button" tabIndex={0} aria-label={`Detail vozidla ${vehicle.name || 'Bez modelu'}`} onClick={() => openEdit(vehicle)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit(vehicle) } }}>
              <div className="split"><div><b>{vehicle.name || 'Bez modelu'}</b><br /><small className="muted">{vehicle.plate || 'Bez SPZ'}{year ? ` · ${year}` : ''}{note ? ' · ' + note : ''}</small></div><span className="list-row-end">{vehicle.active === false && <span className="pill">Vyřazené</span>}<ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" /></span></div>
            </div>
            {vehicle.active === false && <div className="row-actions list-row-actions">
              <button type="button" onClick={() => restoreVehicle(vehicle)}>Obnovit</button>
            </div>}
          </div>
        })}</div>
      </div>
      <div className="card"><div className="section-title"><h3>Servisní blokace</h3><span className="pill">{data.serviceBlocks.length}</span></div><form className="form two-col" onSubmit={addBlock}><Field label="Vozidlo"><select value={block.vehicleId} onChange={(event) => setBlock({ ...block, vehicleId: event.target.value })}><option value="">Vyber vůz</option>{data.vehicles.filter((vehicle) => vehicle.active !== false).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.plate}</option>)}</select></Field><Field label="Důvod"><input value={block.reason} onChange={(event) => setBlock({ ...block, reason: event.target.value })} /></Field><Field label="Od"><input type="date" min={EARLIEST_PLAN_DATE} max={LATEST_PLAN_DATE} value={block.from} onChange={(event) => setBlock({ ...block, from: event.target.value })} /></Field><Field label="Do"><input type="date" min={EARLIEST_PLAN_DATE} max={LATEST_PLAN_DATE} value={block.to} onChange={(event) => setBlock({ ...block, to: event.target.value })} /></Field><div className="field span2"><button className="primary" type="submit">Přidat blokaci</button></div></form><ul className="service-block-list">{data.serviceBlocks.map((item) => <li key={item.id}><button type="button" className="service-block-row" onClick={() => setOpenBlockId(item.id)}><span><b>{vehicleLabel(item.vehicleId)} · {dateRangeLabel(item.from, item.to)}</b><small>{item.reason || 'Bez důvodu'}</small></span><ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" /></button></li>)}</ul>{!data.serviceBlocks.length && <div className="empty">Žádné servisní blokace.</div>}</div>
    </div>
    <SideDrawer title={editing ? 'Detail vozidla' : 'Přidat vozidlo'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Model"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus required placeholder="Např. Tesla Model 3" /></Field>
        <Field label="SPZ"><input value={form.plate} onChange={(event) => setForm({ ...form, plate: normalizePlate(event.target.value) })} placeholder="např. 1AB 2345" required /></Field>
        <Field label="Rok výroby"><input inputMode="numeric" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="volitelné" /></Field>
        <Field label="Stav"><select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}><option value="true">Aktivní</option><option value="false">Vyřazené</option></select></Field>
        <Field label="Poznámka" className="span2"><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit vozidlo'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zavřít</button>
        </div>
        {editing && editingVehicle && <div className="field span2 drawer-retire">
          {editingVehicle.active === false
            ? <button className="ghost" type="button" onClick={() => restoreVehicle(editingVehicle)}>Obnovit vozidlo</button>
            : <button className="ghost" type="button" onClick={() => retire()}>Vyřadit vozidlo</button>}
          <small className="muted">{editingVehicle.active === false ? 'Vozidlo se znovu nabídne při plánování.' : 'Vyřazené vozidlo se nenabízí do směn. Historie zůstane a jde ho kdykoli obnovit.'}</small>
        </div>}
      </form>
    </SideDrawer>
    {openBlock && <ConfirmActionModal
      title="Servisní blokace"
      message="Po odstranění se vozidlo v těchto dnech znovu nabízí do směn."
      confirmLabel="Odstranit blokaci"
      confirmClass="danger"
      onClose={() => setOpenBlockId('')}
      onConfirm={removeBlock}
    >
      <ActionSummary eyebrow={vehicleLabel(openBlock.vehicleId)} title={dateRangeLabel(openBlock.from, openBlock.to)} meta={openBlock.reason || 'Bez důvodu'} />
    </ConfirmActionModal>}
  </>
}
