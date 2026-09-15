import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { activatedDriverPatch, czechCount, driverRemovalSummary, driverRemovalSummaryText, driverWithDuplicateEmail, isPendingDriver, withoutDriver } from './lib/drivers.js'
import { todayISO } from './lib/dateTime.js'
import { driverAppStatus, driverInviteText, emailInviteUrl, whatsappInviteUrl } from './lib/driverInvite.js'
import { appFriendlyError } from './lib/errors.js'
import { showNotice } from './lib/notice.js'
import { takeBackChange } from './lib/undo.js'

const emptyDriverForm = Object.freeze({ name: '', phone: '', email: '', profileId: '', active: true, note: '' })
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const freshDriverForm = () => ({ ...emptyDriverForm })
const isValidEmail = (email = '') => {
  const value = String(email || '').trim()
  return !value || emailPattern.test(value)
}
const confirmationText = (value = '') => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('cs')
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
export function Drivers({ data, commit, services, ui, onlineMode = false, reloadOnline, canRemoveDrivers = false, onOpenAvailability }) {
  const { uid, supabase, copyText } = services
  const { ActionSummary, ConfirmActionModal, Field, PageTitle, SideDrawer } = ui
  const [form, setForm] = useState(freshDriverForm)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [removal, setRemoval] = useState(null)
  const [removalConfirmation, setRemovalConfirmation] = useState('')
  const [removing, setRemoving] = useState(false)
  const [activity, setActivity] = useState({})
  const editingDriver = editing ? data.drivers.find((d) => d.id === editing) : null
  const removalDriver = removal ? data.drivers.find((d) => d.id === removal.driverId) : null
  const activeCount = data.drivers.filter((d) => d.active !== false).length
  const driverCount = data.drivers.length
  useEffect(() => {
    if (!onlineMode || !supabase?.rpc) return undefined
    let cancelled = false
    // Staff-only overview; if the database does not have it yet the list simply shows no app status.
    supabase.rpc('rb_driver_activity').then(({ data: rows, error }) => {
      if (cancelled || error || !Array.isArray(rows)) return
      setActivity(Object.fromEntries(rows.map((row) => [row.driver_id, row])))
    })
    return () => { cancelled = true }
  }, [onlineMode, supabase, driverCount])
  const appStatus = (driver) => driverAppStatus({ driver, activity: activity[driver.id], pushSubscriptions: data.pushSubscriptions })
  const inviteCount = onlineMode ? data.drivers.filter((driver) => driver.active !== false && appStatus(driver).needsInvite).length : 0
  const editingStatus = editingDriver ? appStatus(editingDriver) : null
  const inviteText = editingDriver ? driverInviteText({ driver: editingDriver, appUrl: typeof window === 'undefined' ? '' : window.location.origin, hasLogin: editingStatus.known ? editingStatus.hasLogin : Boolean(editingDriver.profileId) }) : ''
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
    if (!name) return showNotice('Vyplň jméno řidiče.')
    if (!isValidEmail(email)) return showNotice('Vyplň platný e-mail řidiče, nebo pole nech prázdné.')
    const duplicateEmailDriver = driverWithDuplicateEmail(data.drivers, email, editing || '')
    if (duplicateEmailDriver) return showNotice(`E-mail už používá řidič ${duplicateEmailDriver.name || duplicateEmailDriver.id}. Uprav existující záznam, aby nevznikly dva profily pro stejné přihlášení.`)
    const payload = { name, phone: form.phone.trim(), email, profileId: form.profileId?.trim() || '', active: form.active !== false, note: form.note.trim() }
    if (editing) commit((prev) => ({ ...prev, drivers: prev.drivers.map((driver) => driver.id === editing ? activatedDriverPatch(driver, payload) : driver) }), 'Řidič upraven.')
    else commit((prev) => ({ ...prev, drivers: [{ id: uid('drv'), ...payload }, ...prev.drivers] }), 'Řidič vytvořen.')
    closeDrawer()
  }
  // Taking a driver out of service keeps the history and can be taken back, so it asks nothing and offers "Vrátit zpět".
  const retire = (driver = editingDriver) => {
    if (!driver) return
    const label = driver.name || 'Bez jména'
    commit((prev) => ({ ...prev, drivers: prev.drivers.map((item) => item.id === driver.id ? { ...item, active: false } : item) }), `Řidič ${label} vyřazen.`)
    if (editing === driver.id) closeDrawer()
    showNotice(`Řidič ${label} je vyřazený. Nenabízí se do směn, historie zůstává.`, {
      tone: 'good',
      undo: () => commit((prev) => takeBackChange(prev, [{ key: 'drivers', before: [driver] }]), `Vyřazení řidiče ${label} vráceno zpět.`),
    })
  }
  const restore = (driver) => commit((prev) => ({ ...prev, drivers: prev.drivers.map((item) => item.id === driver.id ? activatedDriverPatch(item, { active: true }) : item) }), isPendingDriver(driver) ? 'Řidič schválen.' : 'Řidič obnoven.')
  const openRemoval = (kind) => {
    if (!editingDriver) return
    setRemovalConfirmation('')
    setRemoval({ kind, driverId: editingDriver.id })
  }
  const closeRemoval = () => { if (!removing) setRemoval(null) }
  const removalLabel = removalDriver?.name?.trim() || 'Bez jména'
  const removalConfirmWord = removalDriver?.name?.trim() || 'ODSTRANIT'
  const removalConfirmed = confirmationText(removalConfirmation) === confirmationText(removalConfirmWord)
  const confirmRemoval = async () => {
    const driver = removalDriver
    if (!driver || removing) return
    const label = driver.name?.trim() || 'Bez jména'
    const complete = removal.kind === 'complete'
    if (!onlineMode || !supabase) {
      if (!complete) return
      commit((prev) => withoutDriver(prev, driver.id), `Řidič ${label} byl trvale odstraněn i s historií.`)
      setRemoval(null)
      closeDrawer()
      return
    }
    setRemoving(true)
    const { data: result, error } = await supabase.rpc(complete ? 'rb_delete_driver_completely' : 'rb_delete_driver_login', { p_driver_id: driver.id })
    if (error) {
      setRemoving(false)
      showNotice(appFriendlyError(error.message), { tone: 'bad' })
      return
    }
    await reloadOnline?.(true)
    setRemoving(false)
    setRemoval(null)
    if (complete) {
      closeDrawer()
      showNotice(`Řidič ${label} byl trvale odstraněn i s historií (${czechCount(Number(result?.shifts || 0), 'směna', 'směny', 'směn')}, ${czechCount(Number(result?.settlements || 0), 'výčetka', 'výčetky', 'výčetek')}).`, { tone: 'good' })
    } else {
      // The saved form must not write the removed login back.
      setForm((current) => ({ ...current, profileId: '' }))
      showNotice(`Přihlašovací účet řidiče ${label} je odstraněný. Ať si v aplikaci vytvoří nový účet s e-mailem ${driver.email}.`, { tone: 'good' })
    }
  }
  const pendingCount = data.drivers.filter(isPendingDriver).length
  const sortedDrivers = [...data.drivers].sort((a, b) => Number(isPendingDriver(b)) - Number(isPendingDriver(a)))

  return <>
    <PageTitle title="Řidiči">{onOpenAvailability && <button className="ghost" onClick={onOpenAvailability}>Dostupnost a nepřítomnost</button>}<button className="primary" onClick={openCreate}>+ Přidat řidiče</button></PageTitle>
    <div className="card">
      <div className="section-title"><h3>Seznam řidičů</h3><span className="pill">{activeCount} aktivní / {data.drivers.length} celkem{pendingCount ? ` · ${pendingCount} čeká na schválení` : ''}{inviteCount ? ` · ${inviteCount} k pozvání` : ''}</span></div>
      <div className="stack compact-list">{sortedDrivers.map((driver) => {
        const pending = isPendingDriver(driver)
        const status = appStatus(driver)
        return <div className={pending ? 'log list-row pending-driver-row' : 'log list-row'} key={driver.id}>
          <div className="list-row-main" role="button" tabIndex={0} aria-label={`Detail řidiče ${driver.name || 'Bez jména'}`} onClick={() => openEdit(driver)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit(driver) } }}>
            <div className="split">
              <div><b>{driver.name || 'Bez jména'}</b><br /><small className="muted">{driver.phone || 'Bez telefonu'} · {driver.email || 'Bez e-mailu'}</small>{onlineMode && status.known && <small className={status.needsInvite && driver.active !== false ? 'driver-app-status warn' : 'driver-app-status'}>{status.label} · {status.pushEnabled ? 'notifikace zapnuté' : 'notifikace vypnuté'}</small>}</div>
              <span className="list-row-end">{driver.active === false && <span className={pending ? 'pill warn' : 'pill'}>{pending ? 'Čeká na schválení' : 'Vyřazený'}</span>}<ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" /></span>
            </div>
            {driver.note && <p className="muted compact-note">{driver.note}</p>}
          </div>
          {driver.active === false && <div className="row-actions list-row-actions">
            <button type="button" className={pending ? 'primary' : ''} onClick={() => restore(driver)}>{pending ? 'Schválit' : 'Obnovit'}</button>
          </div>}
        </div>
      })}</div>
    </div>
    <SideDrawer title={editing ? 'Detail řidiče' : 'Přidat řidiče'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Jméno řidiče" className="span2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus required placeholder="Např. Aleš Novák" /></Field>
        <Field label="E-mail"><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="volitelné" /></Field>
        <Field label="Telefon"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        <Field label="Role"><input value="Řidič" readOnly /></Field>
        <Field label="Stav"><select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}><option value="true">Aktivní</option><option value="false">Vyřazený</option></select></Field>
        <Field label="Poznámka" className="span2"><textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
        {/* account linking is normally automatic (same e-mail at sign-up); the raw ID is only for fixing a broken link */}
        <details className="field span2 drawer-advanced">
          <summary>Propojení s účtem (pokročilé)</summary>
          <Field label="ID uživatelského účtu"><input value={form.profileId || ''} onChange={(event) => setForm({ ...form, profileId: event.target.value })} placeholder="obvykle není potřeba, řidič se propojí přes stejný e-mail" /></Field>
        </details>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit řidiče'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zavřít</button>
        </div>
        {editing && editingDriver && <div className="field span2 drawer-retire">
          {editingDriver.active === false
            ? <button className="ghost" type="button" onClick={() => restore(editingDriver)}>{isPendingDriver(editingDriver) ? 'Schválit řidiče' : 'Obnovit řidiče'}</button>
            : <button className="ghost" type="button" onClick={() => retire()}>Vyřadit řidiče</button>}
          <small className="muted">{editingDriver.active === false ? 'Řidič se znovu nabídne do směn a uvidí je v aplikaci.' : 'Vyřazený řidič se nenabízí do směn. Historie zůstane a jde ho kdykoli obnovit.'}</small>
        </div>}
        {editing && editingDriver && <div className="field span2 driver-invite">
          <span className="drawer-section-title">Aplikace řidiče</span>
          {onlineMode && editingStatus.known && <small className={editingStatus.needsInvite ? 'driver-app-status warn' : 'driver-app-status'}>{editingStatus.label} · {editingStatus.pushEnabled ? 'notifikace zapnuté' : 'notifikace vypnuté'}</small>}
          <div className="driver-invite-actions">
            <a className="ghost" href={whatsappInviteUrl(editingDriver.phone, inviteText)} target="_blank" rel="noopener noreferrer">Pozvat přes WhatsApp</a>
            {editingDriver.email && <a className="ghost" href={emailInviteUrl(editingDriver.email, inviteText)}>Pozvat e-mailem</a>}
            <button className="ghost" type="button" onClick={() => copyText(inviteText)}>Kopírovat pozvánku</button>
          </div>
          <small className="muted">Odkaz na aplikaci, registraci stejným e-mailem, přidání na plochu a zapnutí notifikací.</small>
        </div>}
        {editing && canRemoveDrivers && editingDriver && <div className="field span2 driver-removal">
          <span className="drawer-section-title">Odstranění řidiče</span>
          {onlineMode && editingDriver.profileId && <>
            <button className="danger" type="button" onClick={() => openRemoval('login')}>Odstranit přihlašovací účet</button>
            <small className="muted">Když řidič nemůže obnovit heslo. Směny i výčetky zůstanou a řidič si vytvoří nový účet se stejným e-mailem.</small>
          </>}
          <button className="danger" type="button" onClick={() => openRemoval('complete')}>Trvale odstranit řidiče</button>
          <small className="muted">Když řidič odešel. Odstraní i jeho směny, výčetky, výměny a přihlašovací účet. Nejde vrátit.</small>
        </div>}
      </form>
    </SideDrawer>
    {removalDriver && removal.kind === 'complete' && <ConfirmActionModal
      title="Trvale odstranit řidiče"
      message={`${removalLabel} zmizí z aplikace i s celou historií. Tuto akci nejde vrátit.`}
      warning={`${driverRemovalSummaryText(driverRemovalSummary(data, removalDriver.id, todayISO()), { hasLogin: Boolean(removalDriver.profileId) })} Výčetky potřebné pro účetnictví si nejdřív ulož (Nastavení → Záloha a export).`}
      confirmLabel={removing ? 'Odstraňuji…' : 'Trvale odstranit'}
      confirmClass="danger"
      confirmDisabled={!removalConfirmed || removing}
      onClose={closeRemoval}
      onConfirm={confirmRemoval}
    >
      <ActionSummary eyebrow="Řidič" title={removalLabel} meta={removalDriver.email || removalDriver.phone || 'Bez kontaktu'} />
      <Field label={`Pro potvrzení napiš: ${removalConfirmWord}`}>
        <input value={removalConfirmation} onChange={(event) => setRemovalConfirmation(event.target.value)} autoComplete="off" autoFocus />
      </Field>
    </ConfirmActionModal>}
    {removalDriver && removal.kind === 'login' && <ConfirmActionModal
      title="Odstranit přihlašovací účet"
      message={`${removalLabel} se starým účtem už nepřihlásí. Směny, výčetky i ostatní údaje zůstanou.`}
      warning={removalDriver.email
        ? `Potom ať si řidič v aplikaci vytvoří nový účet s e-mailem ${removalDriver.email}. Aplikace ho sama napojí na jeho historii.`
        : 'Řidič nemá uložený e-mail. Doplň ho a ulož, jinak se nový účet na jeho historii nenapojí.'}
      confirmLabel={removing ? 'Odstraňuji…' : 'Odstranit účet'}
      confirmClass="danger"
      confirmDisabled={!removalDriver.email || removing}
      onClose={closeRemoval}
      onConfirm={confirmRemoval}
    >
      <ActionSummary eyebrow="Řidič" title={removalLabel} meta={removalDriver.email || 'Bez e-mailu'} />
    </ConfirmActionModal>}
  </>
}
