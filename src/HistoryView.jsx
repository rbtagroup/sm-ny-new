import { useEffect, useState } from 'react'
import { todayISO } from './lib/dateTime.js'

const pageSize = 50
const typeOptions = {
  all: 'Všechny typy',
  shifts: 'Směny',
  drivers: 'Řidiči',
  vehicles: 'Vozidla',
  availability: 'Dostupnost',
  notifications: 'Notifikace',
  settings: 'Nastavení',
  other: 'Ostatní',
}

const logDate = (log) => String(log.at || log.createdAt || '').slice(0, 10)
const logText = (log) => String(log.text || log.action || '')
const logActor = (log) => log.actor || log.user || log.userName || log.payload?.user || log.payload?.actor || ''
const logType = (log) => {
  const text = logText(log).toLocaleLowerCase('cs-CZ')
  if (/směn|smen|shift|výměn|vymen|koliz/.test(text)) return 'shifts'
  if (/řidič|ridic|driver/.test(text)) return 'drivers'
  if (/vozidl|vozidlo|vůz|vuz|auto|car|spz/.test(text)) return 'vehicles'
  if (/dostupnost|nepřítomnost|nepritomnost|absence/.test(text)) return 'availability'
  if (/notifik|upozorn/.test(text)) return 'notifications'
  if (/nastaven|šablon|sablon|firma|integrac|supabase/.test(text)) return 'settings'
  return 'other'
}
const csvEscape = (cell) => `"${String(cell).replaceAll('"', '""')}"`

export function History({ data, ui, services }) {
  const { Field, PageTitle } = ui
  const { download } = services
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const logs = [...(data.audit || [])].sort((a, b) => String(b.at || b.createdAt || '').localeCompare(String(a.at || a.createdAt || '')))
  const filtered = logs.filter((log) => {
    const d = logDate(log)
    const text = logText(log).toLocaleLowerCase('cs-CZ')
    const actor = String(logActor(log)).toLocaleLowerCase('cs-CZ')
    const q = userFilter.trim().toLocaleLowerCase('cs-CZ')
    if (dateFrom && d && d < dateFrom) return false
    if (dateTo && d && d > dateTo) return false
    if (typeFilter !== 'all' && logType(log) !== typeFilter) return false
    if (q && !actor.includes(q) && !text.includes(q)) return false
    return true
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  useEffect(() => setPage(1), [dateFrom, dateTo, userFilter, typeFilter])

  const resetFilters = () => { setDateFrom(''); setDateTo(''); setUserFilter(''); setTypeFilter('all'); setPage(1) }
  const exportFiltered = () => {
    const rows = [['Datum','Typ','Uživatel','Popis']]
    filtered.forEach((log) => rows.push([new Date(log.at || log.createdAt || '').toLocaleString('cs-CZ'), typeOptions[logType(log)] || 'Ostatní', logActor(log) || '', logText(log)]))
    const csv = rows.map((row) => row.map(csvEscape).join(';')).join('\n')
    download(`rbshift-historie-${todayISO()}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
  }

  return <>
    <PageTitle title="Historie změn">
      <button className="ghost" onClick={resetFilters}>Reset filtrů</button>
      <button className="primary" onClick={exportFiltered}>Export CSV</button>
    </PageTitle>
    <div className="card">
      <div className="section-title"><h3>Filtry</h3><span className="pill">{filtered.length} / {logs.length}</span></div>
      <div className="form four">
        <Field label="Datum od"><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Field>
        <Field label="Datum do"><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field>
        <Field label="Uživatel / text"><input value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder="jméno, e-mail nebo text akce" /></Field>
        <Field label="Typ akce"><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>{Object.entries(typeOptions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      </div>
    </div>
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title">
        <h3>Záznamy</h3>
        <span className="pill">strana {safePage}/{totalPages} · {pageRows.length} záznamů</span>
      </div>
      <div className="stack">
        {pageRows.map((log) => {
          const type = logType(log)
          const date = log.at || log.createdAt || ''
          const text = logText(log)
          const actor = logActor(log)
          return <details className="collapse-card history-item" key={log.id || `${date}-${text}`} style={{ border: '1px solid var(--line)', borderRadius: 16, background: 'rgba(255,255,255,.035)' }}>
            <summary>
              <span><b>{text || 'Záznam bez popisu'}</b><small>{date ? new Date(date).toLocaleString('cs-CZ') : 'bez data'}{actor ? ` · ${actor}` : ''}</small></span>
              <span className="pill">{typeOptions[type] || 'Ostatní'}</span>
            </summary>
            <div className="collapse-content">
              <div className="grid two">
                <div className="log"><b>Detail akce</b><br /><span className="muted">{text || 'Bez detailu'}</span></div>
                <div className="log"><b>Metadata</b><br /><span className="muted">ID: {log.id || '—'}<br />Typ: {typeOptions[type] || 'Ostatní'}<br />Uživatel: {actor || 'nezjištěno'}</span></div>
              </div>
              {log.payload && <pre className="log" style={{ overflow: 'auto', marginTop: 12 }}>{JSON.stringify(log.payload, null, 2)}</pre>}
            </div>
          </details>
        })}
        {!pageRows.length && <div className="empty">Žádné záznamy neodpovídají filtrům.</div>}
      </div>
      <div className="row-actions" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <button className="ghost" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1}>← Předchozí</button>
        <span className="muted">Zobrazeno {(safePage - 1) * pageSize + (pageRows.length ? 1 : 0)}–{(safePage - 1) * pageSize + pageRows.length} z {filtered.length}</span>
        <button className="ghost" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages}>Další →</button>
      </div>
    </div>
  </>
}
