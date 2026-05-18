import { useState } from 'react'
import { shiftTypeMap } from './lib/appConfig.js'
import { uid } from './lib/ids.js'
import { normalizeShiftTemplates } from './lib/shiftTemplates.js'

const emptyTemplateForm = Object.freeze({ name: '', start: '07:00', end: '19:00', active: true, type: 'custom' })
const freshTemplateForm = () => ({ ...emptyTemplateForm })
const formFromTemplate = (template = {}) => ({ ...freshTemplateForm(), ...template })

export function ShiftTemplates({ data, commit, ui }) {
  const { ActionSummary, ConfirmActionModal, Field, PageTitle, Select, SideDrawer } = ui
  const templates = normalizeShiftTemplates(data.settings)
  const [form, setForm] = useState(freshTemplateForm)
  const [editing, setEditing] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [templateToDeactivate, setTemplateToDeactivate] = useState(null)
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
    if (!name) return alert('Vyplň název šablony.')
    if (!form.start || !form.end) return alert('Vyplň začátek a konec šablony.')
    const payload = { id: editing || uid('tpl'), name, start: form.start, end: form.end, active: form.active !== false, type: form.type || 'custom' }
    if (editing) saveTemplates((items) => items.map((template) => template.id === editing ? { ...template, ...payload } : template), 'Šablona směny upravena.')
    else saveTemplates((items) => [payload, ...items], 'Šablona směny vytvořena.')
    closeDrawer()
  }
  const deactivate = (template) => {
    if (!template?.id) return
    setTemplateToDeactivate(template)
  }
  const confirmDeactivate = () => {
    if (!templateToDeactivate?.id) return
    saveTemplates((items) => items.map((item) => item.id === templateToDeactivate.id ? { ...item, active: false } : item), 'Šablona směny deaktivována.')
    setTemplateToDeactivate(null)
    closeDrawer()
  }
  const restore = (template) => saveTemplates((items) => items.map((item) => item.id === template.id ? { ...item, active: true } : item), 'Šablona směny znovu aktivována.')

  return <>
    <PageTitle title="Šablony směn"><button className="primary" onClick={openCreate}>+ Přidat šablonu</button></PageTitle>
    <div className="card">
      <div className="section-title"><h3>Časy směn</h3><span className="pill">{activeCount} aktivní / {templates.length} celkem</span></div>
      <div className="stack compact-list">
        {templates.map((template) => <div className="log list-row" key={template.id}>
          <div className="list-row-main" role="button" tabIndex={0} onClick={() => openEdit(template)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit(template) } }}>
            <div className="split">
              <div><b>{template.name}</b><br /><small className="muted">{template.start}–{template.end} · {shiftTypeMap[template.type] || 'Vlastní'}</small></div>
              <span className={template.active ? 'pill good' : 'pill bad'}>{template.active ? 'Aktivní' : 'Neaktivní'}</span>
            </div>
          </div>
          <div className="row-actions list-row-actions">
            <button onClick={() => openEdit(template)}>Upravit</button>
            {template.active === false ? <button onClick={() => restore(template)}>Obnovit</button> : <button className="danger-mini" onClick={() => deactivate(template)}>Deaktivovat</button>}
          </div>
        </div>)}
      </div>
    </div>
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title"><h3>Použití při tvorbě směny</h3></div>
      <div className="log"><b>Dropdown „Šablona směny“</b><br /><span className="muted">Při vytváření nové směny se v nabídce zobrazují jen aktivní šablony. Volba „Vlastní čas“ zůstává dostupná vždy.</span></div>
    </div>
    <SideDrawer title={editing ? 'Detail šablony' : 'Přidat šablonu'} open={drawerOpen} onClose={closeDrawer}>
      <form className="form two-col" onSubmit={submit}>
        <Field label="Název šablony" className="span2"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus required /></Field>
        <Field label="Začátek"><input type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} required /></Field>
        <Field label="Konec"><input type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} required /></Field>
        <Field label="Typ směny"><Select value={form.type} onChange={(value) => setForm({ ...form, type: value })} options={shiftTypeMap} /></Field>
        <Field label="Aktivní"><select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}><option value="true">Ano</option><option value="false">Ne</option></select></Field>
        <div className="field span2 drawer-form-actions">
          <button className="primary" type="submit">{editing ? 'Uložit změny' : 'Vytvořit šablonu'}</button>
          <button className="ghost" type="button" onClick={closeDrawer}>Zrušit</button>
        </div>
        {editing && <div className="field span2">
          <button className="danger" type="button" onClick={() => deactivate(form)} disabled={form.active === false}>Deaktivovat šablonu</button>
        </div>}
      </form>
    </SideDrawer>
    {templateToDeactivate && <ConfirmActionModal
      title="Deaktivovat šablonu směny"
      message="Šablona se přestane nabízet při tvorbě nových směn. Existující směny se nezmění."
      confirmLabel="Deaktivovat šablonu"
      confirmClass="danger"
      onClose={() => setTemplateToDeactivate(null)}
      onConfirm={confirmDeactivate}
    >
      <ActionSummary eyebrow="Šablona" title={templateToDeactivate.name} meta={`${templateToDeactivate.start}–${templateToDeactivate.end} · ${shiftTypeMap[templateToDeactivate.type] || 'Vlastní'}`} />
    </ConfirmActionModal>}
  </>
}
