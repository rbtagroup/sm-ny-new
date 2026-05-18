import { useState } from 'react'

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
  const { ActionSummary, ConfirmActionModal, DeleteIconButton, Field, PageTitle, SideDrawer } = ui
  const [form, setForm] = useState(freshVehicleForm)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [vehicleToDelete, setVehicleToDelete] = useState('')
  const [serviceBlockToDelete, setServiceBlockToDelete] = useState('')
  const [block, setBlock] = useState(() => freshServiceBlock(todayISO))
  const editingVehicle = editing ? data.vehicles.find((vehicle) => vehicle.id === editing) : null
  const deleteVehicle = vehicleToDelete ? data.vehicles.find((vehicle) => vehicle.id === vehicleToDelete) : null
  const deleteServiceBlock = serviceBlockToDelete ? data.serviceBlocks.find((item) => item.id === serviceBlockToDelete) : null
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
    if (!name) return alert('Vyplň model vozidla.')
    if (!plate || !isValidPlate(plate)) return alert('Vyplň platnou SPZ. Použij 2–16 znaků: písmena, čísla, mezery nebo pomlčky.')
    if (!isValidVehicleYear(year)) return alert('Rok výroby musí být mezi 1990 a příštím rokem.')
    const payload = { name, plate, active: form.active !== false, note: composeVehicleNote(year, form.note) }
    if (editing) commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((vehicle) => vehicle.id === editing ? { ...vehicle, ...payload } : vehicle) }), 'Vozidlo upraveno.')
    else commit((prev) => ({ ...prev, vehicles: [{ id: uid('car'), ...payload }, ...prev.vehicles] }), 'Vozidlo vytvořeno.')
    closeDrawer()
  }
  const addBlock = (event) => {
    event.preventDefault()
    if (!block.vehicleId) return alert('Vyber vozidlo.')
    commit((prev) => ({ ...prev, serviceBlocks: [{ id: uid('srv'), ...block }, ...prev.serviceBlocks] }), 'Přidána servisní blokace vozidla.')
    setBlock(freshServiceBlock(todayISO))
  }
  const removeBlock = (id) => setServiceBlockToDelete(id)
  const confirmRemoveBlock = () => {
    if (!deleteServiceBlock) return
    commit((prev) => ({ ...prev, serviceBlocks: prev.serviceBlocks.filter((item) => item.id !== deleteServiceBlock.id) }), 'Servisní blokace odstraněna.')
    setServiceBlockToDelete('')
  }
  const softDelete = (vehicle = editingVehicle) => {
    if (!vehicle) return
    setVehicleToDelete(vehicle.id)
  }
  const confirmSoftDelete = () => {
    if (!deleteVehicle) return
    commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((vehicle) => vehicle.id === deleteVehicle.id ? { ...vehicle, active: false } : vehicle) }), 'Vozidlo deaktivováno.')
    const wasEditing = editing === deleteVehicle.id
    setVehicleToDelete('')
    if (wasEditing) closeDrawer()
  }
  const restoreVehicle = (vehicle) => commit((prev) => ({ ...prev, vehicles: prev.vehicles.map((item) => item.id === vehicle.id ? { ...item, active: true } : item) }), 'Vozidlo znovu aktivováno.')

  return <>
    <PageTitle title="Vozidla"><button className="primary" onClick={openCreate}>+ Přidat vozidlo</button></PageTitle>
    <div className="grid two">
      <div className="card">
        <div className="section-title"><h3>Seznam vozidel</h3><span className="pill">{activeCount} aktivní / {data.vehicles.length} celkem</span></div>
        <div className="stack compact-list">{data.vehicles.map((vehicle) => {
          const year = extractVehicleYear(vehicle.note)
          const note = vehicleNoteBody(vehicle.note)
          return <div className="log list-row" key={vehicle.id}>
            <div className="list-row-main" role="button" tabIndex={0} onClick={() => openEdit(vehicle)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit(vehicle) } }}>
              <div className="split"><div><b>{vehicle.name || 'Bez modelu'}</b><br /><small className="muted">{vehicle.plate || 'Bez SPZ'}{year ? ` · ${year}` : ''}{note ? ' · ' + note : ''}</small></div><span className={vehicle.active ? 'pill good' : 'pill bad'}>{vehicle.active ? 'Aktivní' : 'Neaktivní'}</span></div>
            </div>
            <div className="row-actions list-row-actions">
              <button onClick={() => openEdit(vehicle)}>Upravit</button>
              {vehicle.active === false ? <button onClick={() => restoreVehicle(vehicle)}>Obnovit</button> : <DeleteIconButton label="Deaktivovat vozidlo" onClick={() => softDelete(vehicle)} />}
            </div>
          </div>
        })}</div>
      </div>
      <div className="card"><div className="section-title"><h3>Servisní blokace</h3><span className="pill warn">{data.serviceBlocks.length}</span></div><form className="form two-col" onSubmit={addBlock}><Field label="Vozidlo"><select value={block.vehicleId} onChange={(event) => setBlock({ ...block, vehicleId: event.target.value })}><option value="">Vyber vůz</option>{data.vehicles.filter((vehicle) => vehicle.active !== false).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.plate}</option>)}</select></Field><Field label="Důvod"><input value={block.reason} onChange={(event) => setBlock({ ...block, reason: event.target.value })} /></Field><Field label="Od"><input type="date" value={block.from} onChange={(event) => setBlock({ ...block, from: event.target.value })} /></Field><Field label="Do"><input type="date" value={block.to} onChange={(event) => setBlock({ ...block, to: event.target.value })} /></Field><div className="field span2"><button className="primary" type="submit">Přidat blokaci</button></div></form><div className="stack" style={{ marginTop: 12 }}>{data.serviceBlocks.map((item) => <div className="alert warn" key={item.id}>{data.vehicles.find((vehicle) => vehicle.id === item.vehicleId)?.name || 'Vůz'} · {item.from} až {item.to}<br /><small>{item.reason}</small><div className="row-actions" style={{ marginTop: 8 }}><DeleteIconButton label="Odstranit servisní blokaci" onClick={() => removeBlock(item.id)} /></div></div>)}{!data.serviceBlocks.length && <div className="empty">Žádné servisní blokace.</div>}</div></div>
    </div>
    <SideDrawer title={editing ? 'Detail vozidla' : 'Přidat vozidlo'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Model"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus required placeholder="Např. Tesla Model 3" /></Field>
        <Field label="SPZ"><input value={form.plate} onChange={(event) => setForm({ ...form, plate: normalizePlate(event.target.value) })} placeholder="např. 1AB 2345" required /></Field>
        <Field label="Rok výroby"><input inputMode="numeric" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="volitelné" /></Field>
        <Field label="Aktivní"><select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}><option value="true">Ano</option><option value="false">Ne</option></select></Field>
        <Field label="Poznámka" className="span2"><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit vozidlo'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zrušit</button>
        </div>
        {editing && <div className="field span2">
          <button className="danger" type="button" onClick={() => softDelete()} disabled={editingVehicle?.active === false}>Deaktivovat vozidlo</button>
        </div>}
      </form>
    </SideDrawer>
    {deleteVehicle && <ConfirmActionModal
      title="Deaktivovat vozidlo"
      message="Vozidlo se skryje jako neaktivní, ale historické směny a záznamy zůstanou zachované."
      confirmLabel="Deaktivovat vozidlo"
      confirmClass="danger"
      onClose={() => setVehicleToDelete('')}
      onConfirm={confirmSoftDelete}
    >
      <ActionSummary eyebrow="Vozidlo" title={`${deleteVehicle.name || 'Bez modelu'} · ${deleteVehicle.plate || 'Bez SPZ'}`} meta={vehicleNoteBody(deleteVehicle.note) || 'Bez poznámky'} />
    </ConfirmActionModal>}
    {deleteServiceBlock && <ConfirmActionModal
      title="Odstranit servisní blokaci"
      message="Servisní blokace se odstraní z plánování dostupnosti vozidla."
      confirmLabel="Odstranit blokaci"
      confirmClass="danger"
      onClose={() => setServiceBlockToDelete('')}
      onConfirm={confirmRemoveBlock}
    >
      <ActionSummary eyebrow="Blokace" title={`${deleteServiceBlock.from} až ${deleteServiceBlock.to}`} meta={deleteServiceBlock.reason || 'Bez důvodu'} />
    </ConfirmActionModal>}
  </>
}
