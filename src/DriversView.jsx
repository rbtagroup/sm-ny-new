import { useState } from 'react'

const emptyDriverForm = Object.freeze({ name: '', phone: '', email: '', profileId: '', active: true, note: '' })
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const freshDriverForm = () => ({ ...emptyDriverForm })
const isValidEmail = (email = '') => {
  const value = String(email || '').trim()
  return !value || emailPattern.test(value)
}
const formFromDriver = (driver = {}) => ({
  ...freshDriverForm(),
  ...driver,
  name: driver.name || '',
  email: driver.email || '',
  phone: driver.phone || '',
  profileId: driver.profileId || '',
  active: driver.active !== false,
  note: driver.note || '',
})

// TODO: mimo scope - avatar upload a samostatné role řidičů vyžadují Storage/sloupce v Supabase schématu.
export function Drivers({ data, commit, services, ui }) {
  const { uid } = services
  const { ActionSummary, ConfirmActionModal, DeleteIconButton, Field, PageTitle, SideDrawer } = ui
  const [form, setForm] = useState(freshDriverForm)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [driverToDelete, setDriverToDelete] = useState('')
  const editingDriver = editing ? data.drivers.find((d) => d.id === editing) : null
  const deleteDriver = driverToDelete ? data.drivers.find((d) => d.id === driverToDelete) : null
  const activeCount = data.drivers.filter((d) => d.active !== false).length
  const closeDrawer = () => { setDrawerOpen(false); setEditing(null); setForm(freshDriverForm()) }
  const openCreate = () => { setForm(freshDriverForm()); setEditing(null); setDrawerOpen(true) }
  const openEdit = (driver) => {
    setForm(formFromDriver(driver))
    setEditing(driver.id)
    setDrawerOpen(true)
  }
  const submit = (event) => {
    event.preventDefault()
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    if (!name) return alert('Vyplň jméno řidiče.')
    if (!isValidEmail(email)) return alert('Vyplň platný e-mail řidiče, nebo pole nech prázdné.')
    const payload = { name, phone: form.phone.trim(), email, profileId: form.profileId?.trim() || '', active: form.active !== false, note: form.note.trim() }
    if (editing) commit((prev) => ({ ...prev, drivers: prev.drivers.map((driver) => driver.id === editing ? { ...driver, ...payload } : driver) }), 'Řidič upraven.')
    else commit((prev) => ({ ...prev, drivers: [{ id: uid('drv'), ...payload }, ...prev.drivers] }), 'Řidič vytvořen.')
    closeDrawer()
  }
  const softDelete = (driver = editingDriver) => {
    if (!driver) return
    setDriverToDelete(driver.id)
  }
  const confirmSoftDelete = () => {
    if (!deleteDriver) return
    commit((prev) => ({ ...prev, drivers: prev.drivers.map((driver) => driver.id === deleteDriver.id ? { ...driver, active: false } : driver) }), 'Řidič deaktivován.')
    const wasEditing = editing === deleteDriver.id
    setDriverToDelete('')
    if (wasEditing) closeDrawer()
  }
  const restore = (driver) => commit((prev) => ({ ...prev, drivers: prev.drivers.map((item) => item.id === driver.id ? { ...item, active: true } : item) }), 'Řidič znovu aktivován.')

  return <>
    <PageTitle title="Řidiči"><button className="primary" onClick={openCreate}>+ Přidat řidiče</button></PageTitle>
    <div className="card">
      <div className="section-title"><h3>Seznam řidičů</h3><span className="pill">{activeCount} aktivní / {data.drivers.length} celkem</span></div>
      <div className="stack compact-list">{data.drivers.map((driver) => <div className="log list-row" key={driver.id}>
        <div className="list-row-main" role="button" tabIndex={0} onClick={() => openEdit(driver)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit(driver) } }}>
          <div className="split"><div><b>{driver.name || 'Bez jména'}</b><br /><small className="muted">{driver.phone || 'Bez telefonu'} · {driver.email || 'Bez e-mailu'}{driver.profileId ? ' · profil: ' + driver.profileId.slice(0, 8) + '…' : ''}</small></div><span className={driver.active ? 'pill good' : 'pill bad'}>{driver.active ? 'Aktivní' : 'Neaktivní'}</span></div>
          {driver.note && <p className="muted compact-note">{driver.note}</p>}
        </div>
        <div className="row-actions list-row-actions">
          <button onClick={() => openEdit(driver)}>Upravit</button>
          {driver.active === false ? <button onClick={() => restore(driver)}>Obnovit</button> : <DeleteIconButton label="Deaktivovat řidiče" onClick={() => softDelete(driver)} />}
        </div>
      </div>)}</div>
    </div>
    <SideDrawer title={editing ? 'Detail řidiče' : 'Přidat řidiče'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Jméno řidiče" className="span2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus required placeholder="Např. Aleš Novák" /></Field>
        <Field label="E-mail"><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="volitelné" /></Field>
        <Field label="Telefon"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        <Field label="Role"><input value="Řidič" readOnly /></Field>
        <Field label="Aktivní"><select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}><option value="true">Ano</option><option value="false">Ne</option></select></Field>
        <Field label="Profile/Auth ID" className="span2"><input value={form.profileId || ''} onChange={(event) => setForm({ ...form, profileId: event.target.value })} placeholder="volitelné" /></Field>
        <Field label="Poznámka" className="span2"><textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit řidiče'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zrušit</button>
        </div>
        {editing && <div className="field span2">
          <button className="danger" type="button" onClick={() => softDelete()} disabled={editingDriver?.active === false}>Deaktivovat řidiče</button>
        </div>}
      </form>
    </SideDrawer>
    {deleteDriver && <ConfirmActionModal
      title="Deaktivovat řidiče"
      message="Řidič se skryje jako neaktivní, ale jeho historické směny a záznamy zůstanou zachované."
      confirmLabel="Deaktivovat řidiče"
      confirmClass="danger"
      onClose={() => setDriverToDelete('')}
      onConfirm={confirmSoftDelete}
    >
      <ActionSummary eyebrow="Řidič" title={deleteDriver.name || 'Bez jména'} meta={deleteDriver.email || deleteDriver.phone || 'Bez kontaktu'} />
    </ConfirmActionModal>}
  </>
}
