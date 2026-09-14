import { useState } from 'react'
import { formatDate } from './lib/dateTime.js'
import { czechCount } from './lib/drivers.js'
import { uid } from './lib/ids.js'
import { showNotice } from './lib/notice.js'
import {
  blankCoverageSlotForm,
  COVERAGE_WEEKDAYS,
  coverageDaysLabel,
  coverageNeedFor,
  coverageNeedsList,
  coverageSlotForm,
  coverageSlotFromForm,
  removeCoverageSlot,
  saveCoverageSlot,
  setCoverageNeedsForDay,
} from './lib/coverage.js'
import { DayNeedForm, NeedStepper } from './CoverageForms.jsx'

const driversLabel = (count) => czechCount(count, 'řidič', 'řidiči', 'řidičů')
const openOnKey = (open) => (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  open()
}

// Weekly norms (how many drivers are usually needed and when) and the needs set for particular days.
export function CoverageNorms({ data, commit, today, ui }) {
  const { ActionSummary, ConfirmActionModal, Field, PageTitle, SideDrawer } = ui
  const slots = [...(data.settings?.coverageSlots || [])].sort((a, b) => String(a.start).localeCompare(String(b.start)))
  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  const upcomingNeeds = coverageNeedsList(data.settings).filter((entry) => entry.date >= today && slotById.has(entry.slotId))
  const [slotDrawer, setSlotDrawer] = useState(null)
  const [needDate, setNeedDate] = useState('')
  const [slotToRemove, setSlotToRemove] = useState(null)

  const openCreate = () => setSlotDrawer({ id: '', form: blankCoverageSlotForm() })
  const openEdit = (slot) => setSlotDrawer({ id: slot.id, form: coverageSlotForm(slot) })
  const closeSlotDrawer = () => setSlotDrawer(null)
  const setForm = (patch) => setSlotDrawer((current) => (current ? { ...current, form: { ...current.form, ...patch } } : current))
  const toggleDay = (day) => setSlotDrawer((current) => {
    if (!current) return current
    const days = current.form.days.includes(day) ? current.form.days.filter((item) => item !== day) : [...current.form.days, day]
    return { ...current, form: { ...current.form, days } }
  })
  const submitSlot = (event) => {
    event.preventDefault()
    const { slot, error } = coverageSlotFromForm(slotDrawer.form, slotDrawer.id || uid('cov'))
    if (error) return showNotice(error)
    commit((prev) => ({ ...prev, settings: saveCoverageSlot(prev.settings, slot) }), slotDrawer.id ? `Upraveno pásmo pokrytí ${slot.name}.` : `Přidáno pásmo pokrytí ${slot.name}.`)
    closeSlotDrawer()
  }
  const confirmRemove = () => {
    commit((prev) => ({ ...prev, settings: removeCoverageSlot(prev.settings, slotToRemove.id) }), `Smazáno pásmo pokrytí ${slotToRemove.name}.`)
    setSlotToRemove(null)
    closeSlotDrawer()
  }
  const resetNeed = (entry, slot) => commit(
    (prev) => ({ ...prev, settings: setCoverageNeedsForDay(prev.settings, entry.date, { [entry.slotId]: coverageNeedFor(slot, entry.date).base }, today) }),
    `Vrácena běžná potřeba řidičů na ${formatDate(entry.date)} (${slot.name}).`,
  )
  const removalNeeds = slotToRemove ? coverageNeedsList(data.settings).filter((entry) => entry.slotId === slotToRemove.id && entry.date >= today).length : 0
  const form = slotDrawer?.form

  return <>
    <PageTitle title="Normy pokrytí" subtitle="Kolik řidičů potřebujete a kdy. Normy nic neblokují, v plánu jen ukazují, co chybí.">
      <button className="primary" type="button" onClick={openCreate}>+ Přidat pásmo</button>
    </PageTitle>
    <div className="card">
      <div className="section-title"><h3>Běžná potřeba</h3><span className="pill">{slots.length}</span></div>
      <div className="stack compact-list">
        {slots.map((slot) => <div className="log list-row" key={slot.id}>
          <div className="list-row-main" role="button" tabIndex={0} onClick={() => openEdit(slot)} onKeyDown={openOnKey(() => openEdit(slot))}>
            <div className="split">
              <div><b>{slot.name}</b><br /><small className="muted">{slot.start}–{slot.end} · {coverageDaysLabel(slot)}</small></div>
              <span className="pill">{slot.minDrivers ? driversLabel(slot.minDrivers) : 'jen na vybrané dny'}</span>
            </div>
          </div>
          <div className="row-actions list-row-actions">
            <button type="button" onClick={() => openEdit(slot)}>Upravit</button>
            <button type="button" className="danger-mini" onClick={() => setSlotToRemove(slot)}>Smazat</button>
          </div>
        </div>)}
        {!slots.length && <div className="empty">Zatím žádné pásmo. Přidejte třeba „Noc 22:00–06:00, 2 řidiči“.</div>}
      </div>
    </div>
    <div className="card coverage-needs-card">
      <div className="section-title"><h3>Potřeba na konkrétní dny</h3><button className="ghost" type="button" onClick={() => setNeedDate(today)} disabled={!slots.length}>+ Nastavit na den</button></div>
      <div className="stack compact-list">
        {upcomingNeeds.map((entry) => {
          const slot = slotById.get(entry.slotId)
          return <div className="log list-row" key={`${entry.date}-${entry.slotId}`}>
            <div className="list-row-main" role="button" tabIndex={0} onClick={() => setNeedDate(entry.date)} onKeyDown={openOnKey(() => setNeedDate(entry.date))}>
              <div className="split">
                <div><b>{formatDate(entry.date)} · {slot.name}</b><br /><small className="muted">{slot.start}–{slot.end} · běžně {driversLabel(coverageNeedFor(slot, entry.date).base)}</small></div>
                <span className="pill warn">{driversLabel(entry.minDrivers)}</span>
              </div>
            </div>
            <div className="row-actions list-row-actions">
              <button type="button" onClick={() => setNeedDate(entry.date)}>Upravit</button>
              <button type="button" className="danger-mini" onClick={() => resetNeed(entry, slot)}>Vrátit běžnou</button>
            </div>
          </div>
        })}
        {!upcomingNeeds.length && <div className="empty">Zatím žádná. Nastavíte ji tady nebo v plánu směn přes ⋯ u dne.</div>}
      </div>
    </div>

    <SideDrawer title={slotDrawer?.id ? 'Upravit pásmo' : 'Přidat pásmo'} open={Boolean(slotDrawer)} onClose={closeSlotDrawer}>
      {form && <form className="form two-col" onSubmit={submitSlot}>
        <Field label="Název pásma" className="span2"><input value={form.name} onChange={(event) => setForm({ name: event.target.value })} placeholder="Např. Noc, Páteční špička, Ples" autoFocus required /></Field>
        <Field label="Začátek"><input type="time" value={form.start} onChange={(event) => setForm({ start: event.target.value })} required /></Field>
        <Field label="Konec"><input type="time" value={form.end} onChange={(event) => setForm({ end: event.target.value })} required /></Field>
        <div className="field span2">
          <label>Běžně řidičů</label>
          <NeedStepper value={form.minDrivers} label="běžný počet řidičů" onChange={(minDrivers) => setForm({ minDrivers })} />
          <small className="muted coverage-field-hint">0 = pásmo se hlídá jen ve dny, kdy potřebu nastavíte.</small>
        </div>
        <div className="field span2">
          <label>Dny v týdnu</label>
          <div className="weekday-toggles" role="group" aria-label="Dny v týdnu">
            {COVERAGE_WEEKDAYS.map(([day, label]) => {
              const active = form.days.includes(day)
              return <button type="button" key={day} className={active ? 'active' : ''} aria-pressed={active} onClick={() => toggleDay(day)}>{label}</button>
            })}
          </div>
        </div>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{slotDrawer.id ? 'Uložit změny' : 'Přidat pásmo'}</button>
          <button className="ghost" type="button" onClick={closeSlotDrawer}>Zrušit</button>
        </div>
        {slotDrawer.id && <div className="field span2">
          <button className="danger" type="button" onClick={() => setSlotToRemove(slotById.get(slotDrawer.id))}>Smazat pásmo</button>
        </div>}
      </form>}
    </SideDrawer>
    <SideDrawer title="Potřeba řidičů" open={Boolean(needDate)} onClose={() => setNeedDate('')}>
      {needDate && <DayNeedForm key={needDate} data={data} commit={commit} date={needDate} today={today} chooseDate ui={ui} onCancel={() => setNeedDate('')} onSaved={() => setNeedDate('')} />}
    </SideDrawer>
    {slotToRemove && <ConfirmActionModal
      title="Smazat pásmo pokrytí"
      message="Pásmo zmizí z plánu i z ranního upozornění. Směny, které už existují, se nezmění."
      warning={removalNeeds ? `Smaže se i potřeba nastavená na konkrétní dny (${removalNeeds}).` : ''}
      confirmLabel="Smazat pásmo"
      confirmClass="danger"
      onClose={() => setSlotToRemove(null)}
      onConfirm={confirmRemove}
    >
      <ActionSummary eyebrow="Pásmo" title={slotToRemove.name} meta={`${slotToRemove.start}–${slotToRemove.end} · ${coverageDaysLabel(slotToRemove)} · běžně ${driversLabel(Number(slotToRemove.minDrivers) || 0)}`} />
    </ConfirmActionModal>}
  </>
}
