import { useState } from 'react'
import { formatDateTime } from './lib/dateTime.js'
import { appFriendlyError } from './lib/errors.js'
import {
  driverMessageDeliveryLabel,
  driverMessageDeliveryState,
  driverMessageHistory,
  driverMessageReadCount,
  filterDriverMessageHistory,
  latestDriverMessageDeliveryLog,
} from './lib/driverMessages.js'
import { notificationTargetLabel } from './lib/notificationInbox.js'

const statusLabel = {
  all: 'Vše',
  delivered: 'Doručeno',
  error: 'Chyba',
  'no-device': 'Bez zařízení',
  unknown: 'Bez výsledku',
}

const rangeLabel = {
  '7': '7 dní',
  '30': '30 dní',
  '90': '90 dní',
  all: 'Vše',
}

export function StaffMessageHistory({ data, helpers, ui }) {
  const { Field } = ui
  const [filters, setFilters] = useState({ target: 'all', status: 'all', range: '30' })
  const allMessages = driverMessageHistory(data)
  const messages = filterDriverMessageHistory(data, filters)
  const activeDrivers = (data.drivers || []).filter((driver) => driver.active !== false)
  const update = (patch) => setFilters((current) => ({ ...current, ...patch }))

  return <div className="card staff-message-history">
    <div className="section-title">
      <h3>Historie zpráv řidičům</h3>
      <span className={messages.length ? 'pill good' : 'pill warn'}>{messages.length}/{allMessages.length} zobrazeno</span>
    </div>
    <div className="form staff-message-filters">
      <Field label="Příjemce">
        <select value={filters.target} onChange={(event) => update({ target: event.target.value })}>
          <option value="all">Všechny cíle</option>
          <option value="driver_all">Všichni řidiči</option>
          {activeDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
        </select>
      </Field>
      <Field label="Doručení">
        <select value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Období">
        <select value={filters.range} onChange={(event) => update({ range: event.target.value })}>
          {Object.entries(rangeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
    </div>
    {messages.length ? <div className="staff-message-history-list">
      {messages.map((message) => {
        const deliveryLog = latestDriverMessageDeliveryLog(data, message)
        const deliveryLabel = driverMessageDeliveryLabel(data, message)
        const deliveryState = driverMessageDeliveryState(data, message)
        const readCount = driverMessageReadCount(message)
        const createdAt = message.at || message.createdAt || ''
        const deliveryClass = deliveryState === 'error' || deliveryState === 'no-device'
          ? 'pill warn'
          : deliveryState === 'delivered'
            ? 'pill good'
            : 'pill'

        return <div className="staff-message-history-row" key={message.id}>
          <div className="staff-message-history-head">
            <div className="staff-message-history-title">
              <b>{message.title || 'Bez titulku'}</b>
              <small>{createdAt ? formatDateTime(createdAt) : 'bez času'} · {notificationTargetLabel(message, helpers)}</small>
            </div>
            <div className="staff-message-history-badges">
              <span className={deliveryClass}>{deliveryLabel}</span>
              <span className="pill">{readCount} přečteno</span>
            </div>
          </div>
          <p>{message.body || 'Bez textu'}</p>
          {deliveryLog?.error && <small className="staff-message-delivery-error">Push chyba: {appFriendlyError(deliveryLog.error)}</small>}
        </div>
      })}
    </div> : <div className="empty">Pro vybrané filtry tu nejsou žádné zprávy.</div>}
    <p className="hintline">Historie používá uložený delivery log, pokud už existuje. Starší zprávy bez logu se zobrazí jako bez výsledku nebo podle aktuálních zařízení.</p>
  </div>
}
