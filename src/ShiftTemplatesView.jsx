import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { shiftTypeMap } from './lib/appConfig.js'
import { uid } from './lib/ids.js'
import { normalizeShiftTemplates } from './lib/shiftTemplates.js'
import { showNotice } from './lib/notice.js'

const emptyTemplateForm = Object.freeze({ name: '', start: '07:00', end: '19:00', active: true, type: 'custom' })
const freshTemplateForm = () => ({ ...emptyTemplateForm })
const formFromTemplate = (template = {}) => ({ ...freshTemplateForm(), ...template })

export function ShiftTemplates({ data, commit, ui }) {
  const { Field, PageTitle, Select, SideDrawer } = ui
  const templates = normalizeShiftTemplates(data.settings)
  const [form, setForm] = useState(freshTemplateForm)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const activeCount = templates.filter((template) => template.active).length
  const closeDrawer = () => { setDrawerOpen(false); setEditing(null); setForm(freshTemplateForm()) }
  const openCreate = () => { setForm(freshTemplateForm()); setEditing(null); setDrawerOpen(true) }
  const openEdit = (template) => { setForm(formFromTemplate(template)); setEditing(template.id); setDrawerOpen(true) }
  const saveTemplates = (updater, message) => commit((prev) => {
    const current = normalizeShiftTemplates(prev.settings)
    const nextTemplates = updater(current)
    return { ...prev, settings: { ...prev.settings, shiftTemplates: nextTemplates } }
  }, message)
  const submit = (event) => {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) return showNotice('Vyplň název šablony.')
    if (!form.start || !form.end) return showNotice('Vyplň začátek a konec šablony.')
    const payload = { id: editing || uid('tpl'), name, start: form.start, end: form.end, active: form.active !== false, type: form.type || 'custom' }
    if (editing) saveTemplates((items) => items.map((template) => template.id === editing ? { ...template, ...payload } : template), 'Šablona směny upravena.')
    else saveTemplates((items) => [payload, ...items], 'Šablona směny vytvořena.')
    closeDrawer()
  }
  // A retired template only stops being offered, so it asks nothing and the notice can take it back.
  const retire = (template) => {
    const saved = templates.find((item) => item.id === template?.id)
    if (!saved) return
    saveTemplates((items) => items.map((item) => item.id === saved.id ? { ...item, active: false } : item), `Šablona směny ${saved.name} vyřazena.`)
    closeDrawer()
    showNotice(`Šablona ${saved.name} je vyřazená. Nové směny ji nenabízejí, existující se nemění.`, {
      tone: 'good',
      undo: () => saveTemplates((items) => items.map((item) => item.id === saved.id ? saved : item), `Vyřazení šablony ${saved.name} vráceno zpět.`),
    })
  }
  const restore = (template) => saveTemplates((items) => items.map((item) => item.id === template.id ? { ...item, active: true } : item), 'Šablona směny obnovena.')

  return <>
    <PageTitle title="Šablony směn"><button className="primary" onClick={openCreate}>+ Přidat šablonu</button></PageTitle>
    <div className="card">
      <div className="section-title"><h3>Časy směn</h3><span className="pill">{activeCount} aktivní / {templates.length} celkem</span></div>
      <div className="stack compact-list">
        {templates.map((template) => <div className="log list-row" key={template.id}>
          <div className="list-row-main" role="button" tabIndex={0} aria-label={`Detail šablony ${template.name}`} onClick={() => openEdit(template)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit(template) } }}>
            <div className="split">
              <div><b>{template.name}</b><br /><small className="muted">{template.start}–{template.end} · {shiftTypeMap[template.type] || 'Vlastní'}</small></div>
              <span className="list-row-end">{template.active === false && <span className="pill">Vyřazená</span>}<ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" /></span>
            </div>
          </div>
          {template.active === false && <div className="row-actions list-row-actions">
            <button type="button" onClick={() => restore(template)}>Obnovit</button>
          </div>}
        </div>)}
      </div>
      <p className="muted list-card-note">Formulář nové směny nabízí v poli „Šablona směny“ jen aktivní šablony. „Vlastní čas“ jde zvolit vždy.</p>
    </div>
    <SideDrawer title={editing ? 'Detail šablony' : 'Přidat šablonu'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Název šablony" className="span2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus required /></Field>
        <Field label="Začátek"><input type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} required /></Field>
        <Field label="Konec"><input type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} required /></Field>
        <Field label="Typ směny"><Select value={form.type} onChange={(value) => setForm({ ...form, type: value })} options={shiftTypeMap} /></Field>
        <Field label="Stav"><select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}><option value="true">Aktivní</option><option value="false">Vyřazená</option></select></Field>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit šablonu'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zavřít</button>
        </div>
        {editing && <div className="field span2 drawer-retire">
          {templates.find((item) => item.id === editing)?.active === false
            ? <button className="ghost" type="button" onClick={() => { restore({ id: editing }); closeDrawer() }}>Obnovit šablonu</button>
            : <button className="ghost" type="button" onClick={() => retire({ id: editing })}>Vyřadit šablonu</button>}
          <small className="muted">Vyřazená šablona se přestane nabízet u nových směn. Existující směny se nezmění.</small>
        </div>}
      </form>
    </SideDrawer>
  </>
}
