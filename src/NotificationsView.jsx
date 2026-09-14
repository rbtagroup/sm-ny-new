import { useState } from 'react'
import { Check, MessageSquarePlus, Trash2 } from 'lucide-react'
import { PushSetupCard } from './PushSetupCard.jsx'
import { StaffMessageComposer } from './StaffMessageComposer.jsx'
import { StaffMessageHistory } from './StaffMessageHistory.jsx'
import { todayISO } from './lib/dateTime.js'
import { splitStaffInbox } from './lib/staffNotifications.js'
import { driverMessageHistory } from './lib/driverMessages.js'
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
  const { PageTitle, SideDrawer } = ui
  const [composerOpen, setComposerOpen] = useState(false)
  const inboxContext = { currentDriver, isDriver, profile, swapRequests: data.swapRequests }
  const { visible, unread, visibleIds, groups, hasRead } = notificationInboxState(data, inboxContext)
  // Dispatch sees what waits for it first; handled items and notices sent to drivers stay folded below.
  const staffInbox = isDriver ? null : splitStaffInbox(visible, data, { today: todayISO(), isRead: (notice) => isInboxNoticeRead(notice, inboxContext) })
  const notificationGroups = isDriver ? groups : groupStaffNotificationsByCategory(staffInbox.open)
  const unreadCount = isDriver ? unread.length : staffInbox.openUnread.length
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
  const hideNotices = (items, message) => {
    const ids = new Set(items.map((n) => n.id))
    if (!ids.size) return
    commit((prev) => ({ ...prev, notifications: markInboxNotificationsDeleted(prev.notifications || [], ids, inboxContext) }), message)
    queueUndo([...ids])
  }
  // Read items that still wait for dispatch stay listed until they are handled.
  const clearRead = () => hideNotices(visible.filter((n) => isInboxNoticeRead(n, inboxContext) && !staffInbox?.open.includes(n)), 'Přečtené notifikace skryty.')
  const staffNotificationActions = !isDriver ? <>
    <button className="primary notification-toolbar-button" type="button" onClick={() => setComposerOpen(true)}><MessageSquarePlus size={17} strokeWidth={2.3} aria-hidden="true" />Nová zpráva řidičům</button>
    <button className="ghost notification-toolbar-button" onClick={markAll}><Check size={17} strokeWidth={2.4} aria-hidden="true" />Přečteno vše</button>
    <button className="danger notification-toolbar-button" onClick={clearRead}><Trash2 size={17} strokeWidth={2.2} aria-hidden="true" />Skrýt přečtené</button>
  </> : null
  // Folded staff sections need no read state: nothing there waits for dispatch.
  const renderNotice = (n, options = {}) => {
    const read = options.archived === true || isInboxNoticeRead(n, inboxContext)
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
    <div className={`card notifications-card ${isDriver ? 'driver-notifications-card' : ''}`.trim()}><div className="section-title"><h3>{isDriver ? 'Doručené' : 'K vyřízení'}</h3><span className={unreadCount ? 'pill warn' : 'pill good'}>{isDriver ? `${unreadCount} nepřečteno` : `${staffInbox.open.length} čeká · ${unreadCount} nepřečteno`}</span></div>
      {isDriver && (unread.length > 0 || hasRead) && <div className="driver-notifications-toolbar">
        {unread.length > 0 && <button className="ghost" type="button" onClick={markAll}><Check size={17} strokeWidth={2.4} aria-hidden="true" />Přečteno vše</button>}
        {hasRead && <button className="ghost danger-soft" type="button" onClick={clearRead}><Trash2 size={17} strokeWidth={2.2} aria-hidden="true" />Skrýt přečtené</button>}
      </div>}
      <div className="notification-groups">
      {notificationGroups.map(([label, items]) => <section className="notification-group" key={label}>
        <div className="notification-group-title">{label}</div>
        <div className="stack">{items.map(renderNotice)}</div>
      </section>)}
      {isDriver && !visible.length && <div className="empty driver-empty-inbox"><b>Žádná upozornění</b><br /><span className="muted">Vše je vyřízené.</span></div>}
      {!isDriver && !staffInbox.open.length && <div className="empty">Nic nečeká na vyřízení.</div>}
      {!isDriver && [
        ['done', 'Vyřízené a informace', staffInbox.done, 'Skrýt vyřízené', 'Vyřízené notifikace skryty.'],
        ['sent', 'Odesláno řidičům', staffInbox.sent, 'Skrýt odeslané', 'Odeslané notifikace skryty.'],
      ].filter(([, , items]) => items.length).map(([key, label, items, hideLabel, hideMessage]) => <details className="notification-archive" key={key} data-section={key}>
        <summary><span>{label}</span><span className="pill">{items.length}</span></summary>
        <div className="stack">{items.map((n) => renderNotice(n, { archived: true }))}</div>
        <button className="ghost danger-soft notification-archive-clear" type="button" onClick={() => hideNotices(items, hideMessage)}><Trash2 size={16} strokeWidth={2.2} aria-hidden="true" />{hideLabel}</button>
      </details>)}
    </div></div>
    {/* Dispatch sees what waits for it on top; sent messages and this device's notifications stay below. */}
    {!isDriver && <details className="card collapse-card notifications-history">
      <summary><span><b>Odeslané zprávy řidičům</b><small>{driverMessageHistory(data).length ? 'historie, doručení a přečtení' : 'zatím žádná zpráva'}</small></span><span className="pill">{driverMessageHistory(data).length}</span></summary>
      <div className="collapse-content"><StaffMessageHistory data={data} helpers={helpers} ui={ui} embedded /></div>
    </details>}
    {!isDriver && <div className="stack notifications-device"><PushSetupCard data={data} commit={commit} currentDriver={currentDriver} isDriver={isDriver} profile={profile} session={session} ui={ui} services={services} /></div>}
    {!isDriver && SideDrawer && <SideDrawer title="Nová zpráva řidičům" open={composerOpen} onClose={() => setComposerOpen(false)}>
      {composerOpen && <StaffMessageComposer data={data} commit={commit} session={session} ui={ui} services={services} variant="drawer" />}
    </SideDrawer>}
  </>
}
