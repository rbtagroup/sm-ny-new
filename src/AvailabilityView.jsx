import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { todayISO } from './lib/dateTime.js'
import { availabilityKind, availabilityNoteText } from './lib/availability.js'
import { absenceFromForm, availabilityEntryFromForm, availabilityEntryLabel, upcomingAvailability } from './lib/availabilityGrid.js'
import { dateRangeLabel } from './lib/display.js'
import { uid } from './lib/ids.js'
import { showNotice } from './lib/notice.js'
import { AvailabilityEntryForm, blankAvailabilityForm, driverEntryTypes } from './AvailabilityEntryForm.jsx'

const kindLabels = { available: 'Můžu jet', preferred: 'Raději ano', unavailable: 'Nemůžu', absent: 'Nepřítomnost' }
// Quick starts for the common cases; the form opens prefilled and only the day is left to check.
const quickStarts = [
  ['Celý den', { type: 'available', start: '00:00', end: '23:59' }],
  ['Ranní', { type: 'available', start: '06:00', end: '14:00' }],
  ['Noční', { type: 'available', start: '22:00', end: '06:00' }],
  ['Nemůžu', { type: 'unavailable', start: '00:00', end: '23:59' }],
  ['Dovolená', { type: 'absent', reason: 'Dovolená' }],
  ['Nemoc', { type: 'absent', reason: 'Nemoc' }],
]

// The driver's own availability: a list of what is coming up, "+ Přidat" and quick starts for the usual cases.
export function Availability({ data, commit, currentDriver, ui }) {
  const { ActionSummary, ConfirmActionModal, Modal, PageTitle } = ui
  const today = todayISO()
  const [form, setForm] = useState(null)
  const [toRemove, setToRemove] = useState(null)
  const driverId = currentDriver?.id || ''
  const { weekly, dated, absences } = upcomingAvailability(data, driverId, today)
  const empty = !weekly.length && !dated.length && !absences.length

  const open = (patch = {}) => {
    if (!driverId) return showNotice('Řidičský profil není propojený.')
    setForm(blankAvailabilityForm(driverId, today, patch))
  }
  const submit = (event) => {
    event.preventDefault()
    if (form.type === 'absent') {
      const { entry, error } = absenceFromForm(form, uid('abs'))
      if (error) return showNotice(error)
      commit((prev) => ({ ...prev, absences: [entry, ...(prev.absences || [])] }), `${currentDriver?.name || 'Řidič'} zadal nepřítomnost ${dateRangeLabel(entry.from, entry.to)}.`)
      showNotice('Nepřítomnost uložena.', { tone: 'good' })
    } else {
      const { entry, error } = availabilityEntryFromForm(form, uid('av'))
      if (error) return showNotice(error)
      commit((prev) => ({ ...prev, availability: [entry, ...(prev.availability || [])] }), `${currentDriver?.name || 'Řidič'} zadal dostupnost: ${availabilityEntryLabel(entry)}.`)
      showNotice('Dostupnost uložena.', { tone: 'good' })
    }
    setForm(null)
  }
  const confirmRemove = () => {
    if (toRemove.type === 'absence') commit((prev) => ({ ...prev, absences: (prev.absences || []).filter((item) => item.id !== toRemove.entry.id) }), `${currentDriver?.name || 'Řidič'} odstranil nepřítomnost.`)
    else commit((prev) => ({ ...prev, availability: (prev.availability || []).filter((item) => item.id !== toRemove.entry.id) }), `${currentDriver?.name || 'Řidič'} odstranil dostupnost.`)
    setToRemove(null)
  }

  const row = (type, entry) => {
    const kind = type === 'absence' ? 'absent' : availabilityKind(entry)
    const label = type === 'absence' ? dateRangeLabel(entry.from, entry.to) : availabilityEntryLabel(entry)
    const note = type === 'absence' ? entry.reason : availabilityNoteText(entry)
    return <li className="driver-availability-row" key={entry.id}>
      <span className={`availability-chip kind-${kind}`}>{kindLabels[kind]}</span>
      <div className="driver-availability-copy"><b>{label}</b>{note && <small>{note}</small>}</div>
      <button type="button" className="driver-notification-icon-button danger-icon" aria-label={`Odstranit: ${label}`} title="Odstranit" onClick={() => setToRemove({ type, entry, kind, label, note, weekly: type !== 'absence' && !entry.fromAt && !entry.date })}><Trash2 size={18} strokeWidth={2.2} aria-hidden="true" /></button>
    </li>
  }
  const section = (title, items, type, hint) => items.length > 0 && <section className="card driver-availability-section">
    <div className="section-title"><h3>{title}</h3><span className="pill">{items.length}</span></div>
    {hint && <p className="muted driver-availability-hint">{hint}</p>}
    <ul className="driver-availability-list">{items.map((entry) => row(type, entry))}</ul>
  </section>

  return <div className="driver-availability">
    <PageTitle title="Moje dostupnost" subtitle="Dej dispečinku vědět, kdy můžeš jet a kdy ne.">
      <button type="button" className="primary" onClick={() => open()}><Plus size={18} strokeWidth={2.4} aria-hidden="true" />Přidat</button>
    </PageTitle>
    <div className="driver-availability-quick" aria-label="Rychlé zadání">
      {quickStarts.map(([label, patch]) => <button type="button" key={label} className="ghost" onClick={() => open(patch)}>{label}</button>)}
    </div>
    {empty && <div className="card empty driver-availability-empty"><b>Zatím nemáš nic zadané</b><br /><span className="muted">Dispečink pak plánuje jen podle toho, co ví. Přidej, kdy můžeš jet, nebo kdy máš volno.</span></div>}
    {section('Každý týden', weekly, 'availability', 'Platí pořád, dokud záznam neodstraníš.')}
    {section('Konkrétní dny', dated, 'availability')}
    {section('Dovolená a nemoc', absences, 'absence')}

    {form && <Modal title="Přidat dostupnost" onClose={() => setForm(null)} className="driver-swap-modal driver-availability-modal" backdropClassName="driver-swap-modal-backdrop">
      <AvailabilityEntryForm form={form} onChange={setForm} onSubmit={submit} onCancel={() => setForm(null)} types={driverEntryTypes} ui={ui} />
    </Modal>}
    {toRemove && <ConfirmActionModal
      title="Odstranit záznam?"
      message={toRemove.weekly ? 'Záznam platí každý týden, odstraní se ze všech týdnů.' : 'Dispečink ho při plánování přestane vidět.'}
      confirmLabel="Odstranit"
      confirmClass="danger"
      onClose={() => setToRemove(null)}
      onConfirm={confirmRemove}
    >
      <ActionSummary eyebrow={kindLabels[toRemove.kind]} title={toRemove.label} meta={toRemove.note || ''} />
    </ConfirmActionModal>}
  </div>
}
