import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { PushSetupCard } from './PushSetupCard.jsx'
import { StaffMessageComposer } from './StaffMessageComposer.jsx'
import { StaffMessageHistory } from './StaffMessageHistory.jsx'
import {
  groupStaffNotificationsByCategory,
  isInboxNoticeRead,
  markInboxNotificationsDeleted,
  markInboxNotificationsRead,
  notificationCategoryLabel,
  notificationInboxState,
  notificationTargetLabel,
  restoreInboxNotifications,
} from './lib/notificationInbox.js'

export function NotificationsView({ data, helpers, commit, currentDriver, isDriver, profile, session, ui, services }) {
  const { PageTitle } = ui
  const inboxContext = { currentDriver, isDriver, profile, swapRequests: data.swapRequests }
  const { visible, unread, visibleIds, groups, hasRead } = notificationInboxState(data, inboxContext)
  const notificationGroups = isDriver ? groups : groupStaffNotificationsByCategory(visible)
  const [undoDeleteIds, setUndoDeleteIds] = useState([])
  const markOne = (id) => commit((prev) => ({ ...prev, notifications: markInboxNotificationsRead(prev.notifications || [], [id], inboxContext) }), 'Notifikace označena jako přečtená.')
  const queueUndo = (ids) => {
    const clean = [...new Set((ids || []).filter(Boolean))]
    if (!clean.length) return
    setUndoDeleteIds(clean)
    setTimeout(() => {
      setUndoDeleteIds((current) => clean.every((id) => current.includes(id)) ? [] : current)
    }, 5000)
  }
  const deleteOne = (id) => {
    const notice = visible.find((n) => n.id === id)
    if (!notice) return
    commit((prev) => ({ ...prev, notifications: markInboxNotificationsDeleted(prev.notifications || [], [id], inboxContext) }), 'Notifikace skryta.')
    queueUndo([id])
  }
  const undoDelete = () => {
    if (!undoDeleteIds.length) return
    const ids = new Set(undoDeleteIds)
    commit((prev) => ({ ...prev, notifications: restoreInboxNotifications(prev.notifications || [], ids, inboxContext) }), 'Skrytí notifikace vráceno zpět.')
    setUndoDeleteIds([])
  }
  const markAll = () => commit((prev) => ({ ...prev, notifications: markInboxNotificationsRead(prev.notifications || [], visibleIds, inboxContext) }), 'Notifikace označeny jako přečtené.')
  const clearRead = () => {
    const toDelete = visible.filter((n) => isInboxNoticeRead(n, inboxContext))
    if (!toDelete.length) return
    const allToDeleteIds = new Set(toDelete.map((n) => n.id))
    commit((prev) => ({ ...prev, notifications: markInboxNotificationsDeleted(prev.notifications || [], allToDeleteIds, inboxContext) }), 'Přečtené notifikace skryty.')
    queueUndo(toDelete.map((n) => n.id))
  }
  const staffNotificationActions = !isDriver ? <>
    <button className="ghost notification-toolbar-button" onClick={markAll}><Check size={17} strokeWidth={2.4} aria-hidden="true" />Přečteno vše</button>
    <button className="danger notification-toolbar-button" onClick={clearRead}><Trash2 size={17} strokeWidth={2.2} aria-hidden="true" />Skrýt přečtené</button>
  </> : null
  const renderNotice = (n) => {
    const read = isInboxNoticeRead(n, inboxContext)
    const noticeAt = n.at || n.createdAt || new Date().toISOString()

    if (isDriver) {
      return <div className={`driver-notification-row ${read ? 'is-read' : 'is-unread'}`} key={n.id}>
        <div className="driver-notification-row-head">
          <div className="driver-notification-copy">
            <div className="driver-notification-titleline">{!read && <span className="driver-notification-dot" aria-hidden="true"></span>}<b>{n.title}</b></div>
            <small>{new Date(noticeAt).toLocaleString('cs-CZ')}</small>
          </div>
          <div className="driver-notification-row-actions">
            {!read && <button className="driver-notification-icon-button good" type="button" onClick={() => markOne(n.id)} aria-label="Označit jako přečtené" title="Přečteno"><Check size={18} strokeWidth={2.4} aria-hidden="true" /></button>}
            <button className="driver-notification-icon-button danger-icon" type="button" onClick={() => deleteOne(n.id)} aria-label="Skrýt notifikaci" title="Skrýt"><Trash2 size={18} strokeWidth={2.2} aria-hidden="true" /></button>
          </div>
        </div>
        <p>{n.body || 'Bez detailu'}</p>
      </div>
    }

    return <div className={`notification-row staff-notification-row ${read ? 'notification-read' : 'notification-unread'}`} key={n.id}>
      <div className="driver-notification-row-head">
        <div className="driver-notification-copy">
          <div className="driver-notification-titleline">{!read && <span className="driver-notification-dot" aria-hidden="true"></span>}<b>{n.title}</b></div>
          <small>{new Date(noticeAt).toLocaleString('cs-CZ')} · {notificationTargetLabel(n, helpers)} · {notificationCategoryLabel(n)}</small>
        </div>
        <div className="driver-notification-row-actions">
          {!read && <button className="driver-notification-icon-button good" type="button" onClick={() => markOne(n.id)} aria-label="Označit jako přečtené" title="Přečteno"><Check size={18} strokeWidth={2.4} aria-hidden="true" /></button>}
          <button className="driver-notification-icon-button danger-icon" type="button" onClick={() => deleteOne(n.id)} aria-label="Skrýt notifikaci" title="Skrýt"><Trash2 size={18} strokeWidth={2.2} aria-hidden="true" /></button>
        </div>
      </div>
      <p>{n.body || 'Bez detailu'}</p>
    </div>
  }
  return <>
    <PageTitle title="Notifikace">{staffNotificationActions}</PageTitle>
    {undoDeleteIds.length > 0 && <div className="toast-undo"><span>{undoDeleteIds.length === 1 ? 'Notifikace skryta.' : `${undoDeleteIds.length} notifikací skryto.`}</span><button onClick={undoDelete}>Vrátit zpět</button></div>}
    {!isDriver && <StaffMessageComposer data={data} commit={commit} session={session} ui={ui} services={services} />}
    {!isDriver && <StaffMessageHistory data={data} helpers={helpers} ui={ui} />}
    <div className={`card notifications-card ${isDriver ? 'driver-notifications-card' : ''}`.trim()}><div className="section-title"><h3>{isDriver ? 'Doručené' : 'Centrum upozornění'}</h3><span className={unread.length ? 'pill warn' : 'pill good'}>{unread.length} nepřečteno</span></div>
      {isDriver && (unread.length > 0 || hasRead) && <div className="driver-notifications-toolbar">
        {unread.length > 0 && <button className="ghost" type="button" onClick={markAll}><Check size={17} strokeWidth={2.4} aria-hidden="true" />Přečteno vše</button>}
        {hasRead && <button className="ghost danger-soft" type="button" onClick={clearRead}><Trash2 size={17} strokeWidth={2.2} aria-hidden="true" />Skrýt přečtené</button>}
      </div>}
      <div className="notification-groups">
      {notificationGroups.map(([label, items]) => <section className="notification-group" key={label}>
        <div className="notification-group-title">{label}</div>
        <div className="stack">{items.map(renderNotice)}</div>
      </section>)}
      {!visible.length && <div className={`empty ${isDriver ? 'driver-empty-inbox' : ''}`.trim()}>{isDriver ? <><b>Žádná upozornění</b><br /><span className="muted">Vše je vyřízené.</span></> : 'Zatím žádné notifikace.'}</div>}
    </div></div>
    {!isDriver && <div className="stack" style={{ marginTop: 16 }}><PushSetupCard data={data} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} session={session} ui={ui} services={services} /></div>}
  </>
}
