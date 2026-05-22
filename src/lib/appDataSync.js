import { useEffect, useRef, useState } from 'react'
import { addedRows, changedRows, stableFingerprint } from './syncDiff.js'
import {
  auditInsertRpcCalls,
  driverPushSubscriptionRowsForSync,
  driverSettlementRowsForSync,
  driverShiftUpdatePatch,
  notificationStateRpcCalls,
  removedNotificationStateRpcCalls,
  staffSwapResolutionRpcCalls,
  swapRequestRpcCallsWithSideEffects,
} from './sensitiveSync.js'
import { createSupabaseMappers, ONLINE_TABLES, tableName } from './supabaseData.js'
import { readStore, seed, STORAGE_KEY, writeStore } from './appStore.js'
import { appFriendlyError } from './errors.js'
import { pushDeliveryWarning } from './pushDelivery.js'
import { uid } from './ids.js'

export function createAppDataSync({ supabase, isConfiguredSupabase = false, timePart, sendPushForNotifications }) {
  const { toDb, fromDb } = createSupabaseMappers({ uid, timePart })

  async function loadDataFromSupabase() {
    if (!supabase) return readStore()
    const base = seed()
    const output = { ...base }
    const errors = []
    const tableResults = await Promise.all(ONLINE_TABLES.map(async (key) => {
      const tn = tableName(key)
      let q = supabase.from(tn).select('*')
      if (key !== 'pushDeliveryLogs') q = q.order(key === 'audit' ? 'created_at' : 'id', { ascending: key !== 'audit' })
      if (key === 'notifications') {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        q = q.gte('created_at', cutoff)
      } else if (key === 'pushDeliveryLogs') {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        q = q.gte('created_at', cutoff).order('created_at', { ascending: false })
      }
      const { data: rows, error } = await q
      return { key, tn, rows, error }
    }))
    for (const { key, tn, rows, error } of tableResults) {
      if (!error) {
        output[key] = (rows || []).map(fromDb[key])
        continue
      }
      if (key === 'settlements' && /does not exist|schema cache/i.test(error.message || '')) { output[key] = []; continue }
      if (key === 'pushDeliveryLogs' && /does not exist|schema cache/i.test(error.message || '')) { output[key] = []; continue }
      if (key === 'audit') { output[key] = []; continue }
      errors.push(`${tn}: ${error.message}`)
    }
    const activeSwapStatusByShift = new Map(
      (output.swapRequests || [])
        .filter((request) => ['pending', 'accepted'].includes(request.status))
        .map((request) => [request.shiftId, request.status]),
    )
    output.shifts = (output.shifts || []).map((shift) => ({
      ...shift,
      swapRequestStatus: activeSwapStatusByShift.get(shift.id) || (['pending', 'accepted'].includes(shift.swapRequestStatus) ? '' : shift.swapRequestStatus),
    }))
    const { data: settingsRow } = await supabase.from('app_settings').select('payload').eq('id','default').maybeSingle()
    output.settings = { ...base.settings, ...(settingsRow?.payload || {}) }
    if (errors.length) throw new Error(errors.join('\n'))
    return output
  }

  async function runRpcCalls(calls = []) {
    const errors = []
    for (const call of calls) {
      const { error } = await supabase.rpc(call.fn, call.args)
      if (error) errors.push(`${call.fn}: ${error.message}`)
    }
    if (errors.length) throw new Error(errors.join('\n'))
  }

  async function syncChangedRows(prev, next, profile) {
    if (!supabase || !profile) return
    const isStaff = ['admin','dispatcher'].includes(profile.role)
    const currentDriver = !isStaff ? (next.drivers || []).find((d) => d.profileId === profile.id || (d.email && profile.email && d.email.toLowerCase() === profile.email.toLowerCase())) : null
    const currentDriverId = currentDriver?.id || ''
    const allowedForDriver = new Set(['shifts','settlements','absences','availability','swapRequests','notifications','pushSubscriptions','audit'])
    const errors = []
    const critical = new Set(['shifts','settlements','swapRequests','notifications','pushSubscriptions'])
    const previousNotificationIds = new Set((prev.notifications || []).map((n) => n.id))
    const previousAuditIds = new Set((prev.audit || []).map((n) => n.id))
    const insertedNotifications = changedRows(prev.notifications, next.notifications).filter((row) => row.id && !previousNotificationIds.has(row.id))
    const insertedAuditRows = changedRows(prev.audit, next.audit).filter((row) => row.id && !previousAuditIds.has(row.id))
    const changedSwapRequests = changedRows(prev.swapRequests, next.swapRequests)
    const handledNotificationIds = new Set()
    const handledAuditIds = new Set()
    const driverSwapShiftIds = new Set(!isStaff ? changedSwapRequests.map((row) => row.shiftId).filter(Boolean) : [])
    const staffSwapResolution = isStaff
      ? staffSwapResolutionRpcCalls(prev.swapRequests, changedSwapRequests, { includeSideEffects: true, notifications: insertedNotifications, auditRows: insertedAuditRows })
      : { calls: [], handledIds: new Set(), handledShiftIds: new Set() }
    ;(staffSwapResolution.handledNotificationIds || new Set()).forEach((id) => handledNotificationIds.add(id))
    ;(staffSwapResolution.handledAuditIds || new Set()).forEach((id) => handledAuditIds.add(id))
    for (const key of ONLINE_TABLES) {
      if (!isStaff && !allowedForDriver.has(key)) continue
      let changed = changedRows(prev[key], next[key])
      if (key === 'notifications' && handledNotificationIds.size) changed = changed.filter((row) => !handledNotificationIds.has(row.id))
      if (key === 'audit' && handledAuditIds.size) changed = changed.filter((row) => !handledAuditIds.has(row.id))
      if (isStaff && key === 'shifts' && staffSwapResolution.handledShiftIds.size) {
        changed = changed.filter((row) => !staffSwapResolution.handledShiftIds.has(row.id))
      }
      // Řidič nesmí přepisovat cizí směny. Převzetí výměny/volné směny se ukládá přes swap_requests.
      if (!isStaff && key === 'shifts') {
        const driverShiftChanges = changed.filter((row) => !driverSwapShiftIds.has(row.id))
        const blocked = driverShiftChanges.filter((row) => row.driverId !== currentDriverId)
        if (blocked.length) {
          errors.push(`shifts: směnu ${blocked.map((row) => row.id).join(', ')} nelze uložit pro aktuálního řidiče`)
          if (critical.has(key)) throw new Error(errors.join('\n'))
        }
        changed = driverShiftChanges.filter((row) => row.driverId === currentDriverId)
      }
      if (!isStaff && key === 'settlements') changed = driverSettlementRowsForSync(changed, currentDriverId)
      if (!isStaff && key === 'pushSubscriptions') changed = driverPushSubscriptionRowsForSync(changed, { profileId: profile.id, currentDriverId })
      if (!isStaff && key === 'notifications') {
        const previousIds = new Set((prev.notifications || []).map((n) => n.id))
        const nextIds = new Set((next.notifications || []).map((n) => n.id))
        const insertedRows = changed.filter((row) => row.id && !previousIds.has(row.id)).map(toDb.notifications)
        const removedPersonalIds = (prev.notifications || [])
          .filter((n) => n.id && !nextIds.has(n.id))
          .map((n) => n.id)
        if (insertedRows.length) {
          const { error } = await supabase.rpc('rb_insert_notifications', { p_notifications: insertedRows })
          if (error) {
            errors.push(`notifications: ${error.message}`)
            if (critical.has(key)) throw new Error(errors.join('\n'))
          }
        }
        const stateCalls = notificationStateRpcCalls(prev.notifications, changed.filter((row) => row.id && previousIds.has(row.id)), currentDriverId)
        if (stateCalls.length) {
          try { await runRpcCalls(stateCalls) }
          catch (error) {
            errors.push(error.message)
            if (critical.has(key)) throw new Error(errors.join('\n'))
          }
        }
        const removalStateCalls = removedNotificationStateRpcCalls(prev.notifications, removedPersonalIds, currentDriverId)
        if (removalStateCalls.length) {
          try { await runRpcCalls(removalStateCalls) }
          catch (error) {
            errors.push(error.message)
            if (critical.has(key)) throw new Error(errors.join('\n'))
          }
        }
        continue
      }
      if (!isStaff && key === 'swapRequests') {
        const { calls, denied, handledNotificationIds: swapNotificationIds, handledAuditIds: swapAuditIds } = swapRequestRpcCallsWithSideEffects(prev.swapRequests, changed, currentDriverId, { includeSideEffects: true, notifications: insertedNotifications, auditRows: insertedAuditRows })
        ;(swapNotificationIds || new Set()).forEach((id) => handledNotificationIds.add(id))
        ;(swapAuditIds || new Set()).forEach((id) => handledAuditIds.add(id))
        if (denied.length) errors.push(`swap_requests: nepovolene akce ${denied.join(', ')}`)
        if (calls.length) {
          try { await runRpcCalls(calls) }
          catch (error) { errors.push(error.message) }
        }
        if (errors.length && critical.has(key)) throw new Error(errors.join('\n'))
        continue
      }
      if (isStaff && key === 'swapRequests') {
        if (staffSwapResolution.calls.length) {
          try { await runRpcCalls(staffSwapResolution.calls) }
          catch (error) { errors.push(error.message) }
        }
        if (errors.length && critical.has(key)) throw new Error(errors.join('\n'))
        changed = changed.filter((row) => !staffSwapResolution.handledIds.has(row.id))
      }
      if (key === 'audit') {
        try { await runRpcCalls(auditInsertRpcCalls(changed)) }
        catch (error) { errors.push(error.message) }
        continue
      }
      if (!isStaff && key === 'shifts') {
        const previousIds = new Set((prev.shifts || []).map((s) => s.id))
        const insertedShiftIds = changed.filter((row) => row.id && !previousIds.has(row.id)).map((row) => row.id)
        if (insertedShiftIds.length) {
          errors.push(`shifts: řidič nemůže vytvořit směnu (${insertedShiftIds.join(', ')})`)
          if (critical.has(key)) throw new Error(errors.join('\n'))
        }
        const rowsToUpdate = changed.filter((row) => row.id && previousIds.has(row.id)).map(toDb.shifts)
        for (const row of rowsToUpdate) {
          const { id } = row
          const patch = driverShiftUpdatePatch(row)
          if (!Object.keys(patch).length) continue
          const { data: updatedRows, error } = await supabase.from('shifts').update(patch).eq('id', id).select('id')
          if (error) {
            errors.push(`shifts: ${error.message}`)
            if (critical.has(key)) throw new Error(errors.join('\n'))
          } else if (!updatedRows?.length) {
            errors.push(`shifts: směnu ${id} se nepodařilo aktualizovat`)
            if (critical.has(key)) throw new Error(errors.join('\n'))
          }
        }
        continue
      }
      const rows = changed.map(toDb[key]).filter((r) => r.id)
      if (rows.length) {
        const { error } = await supabase.from(tableName(key)).upsert(rows, { onConflict: 'id' })
        if (error) {
          errors.push(`${tableName(key)}: ${error.message}`)
          if (critical.has(key)) throw new Error(errors.join('\n'))
        }
      }
      if (isStaff) {
        const nextIds = new Set((next[key] || []).map((x) => x.id))
        const removed = (prev[key] || []).filter((x) => x.id && !nextIds.has(x.id)).map((x) => x.id)
        if (removed.length) {
          const { error } = await supabase.from(tableName(key)).delete().in('id', removed)
          if (error) {
            errors.push(`${tableName(key)} delete: ${error.message}`)
            if (critical.has(key)) throw new Error(errors.join('\n'))
          }
        }
      } else if (!isStaff && key === 'absences' && currentDriverId) {
        const nextAbsIds = new Set((next.absences || []).map((x) => x.id))
        const rmAbsences = (prev.absences || []).filter((x) => x.id && !nextAbsIds.has(x.id) && x.driverId === currentDriverId).map((x) => x.id)
        if (rmAbsences.length) {
          const { error: absErr } = await supabase.from('absences').delete().in('id', rmAbsences)
          if (absErr) errors.push('absences delete: ' + absErr.message)
        }
      }
    }
    if (isStaff && stableFingerprint(prev.settings || {}) !== stableFingerprint(next.settings || {})) {
      const { error } = await supabase.from('app_settings').upsert({ id: 'default', payload: next.settings || {}, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      if (error) errors.push(`app_settings: ${error.message}`)
    }
    if (errors.length) throw new Error(errors.join('\n'))
  }

  async function seedSupabaseFromLocal(localData) {
    if (!supabase) return
    for (const key of ONLINE_TABLES) {
      const rows = (localData[key] || []).map(toDb[key]).filter((r) => r.id)
      if (rows.length) {
        const { error } = await supabase.from(tableName(key)).upsert(rows, { onConflict: 'id' })
        if (error) throw new Error(`${tableName(key)}: ${error.message}`)
      }
    }
    await supabase.from('app_settings').upsert({ id: 'default', payload: localData.settings || {}, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  }

  function useAppData(session, profile) {
    const online = Boolean(isConfiguredSupabase && session?.user && profile)
    const [data, setData] = useState(readStore)
    const dataRef = useRef(data)
    const [syncState, setSyncState] = useState({ loading: online, saving: false, error: '', lastSyncAt: '' })
    const pendingSyncs = useRef(0)
    const deferredReload = useRef(false)

    const reloadOnline = async (silent = false) => {
      if (!online) return
      if (silent && pendingSyncs.current > 0) {
        deferredReload.current = true
        return
      }
      if (!silent) setSyncState((s) => ({ ...s, loading: true, error: '' }))
      try {
        const loaded = await loadDataFromSupabase()
        dataRef.current = loaded
        setData(loaded)
        writeStore(loaded)
        setSyncState((s) => ({ ...s, loading: false, saving: false, error: '', lastSyncAt: new Date().toISOString() }))
      } catch (err) {
        setSyncState((s) => ({ ...s, loading: false, error: appFriendlyError(err.message || String(err)) }))
      }
    }

    const flushDeferredReload = () => {
      if (pendingSyncs.current > 0 || !deferredReload.current) return
      deferredReload.current = false
      reloadOnline(true)
    }

    useEffect(() => { dataRef.current = data }, [data])
    useEffect(() => { if (!online) writeStore(data) }, [data, online])
    useEffect(() => { reloadOnline() }, [online, session?.user?.id])
    useEffect(() => {
      if (online) return undefined
      const handleStorage = (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return
        const stored = readStore()
        dataRef.current = stored
        setData(stored)
      }
      window.addEventListener('storage', handleStorage)
      return () => window.removeEventListener('storage', handleStorage)
    }, [online])
    useEffect(() => {
      if (!online || !supabase) return
      let timer = null
      const pendingTables = new Set()
      const reloadSoon = (payload = {}) => {
        if (payload?.table) pendingTables.add(payload.table)
        clearTimeout(timer)
        timer = setTimeout(() => {
          pendingTables.clear()
          reloadOnline(true)
        }, 700)
      }
      const realtimeTables = ['drivers', 'vehicles', 'shifts', 'shift_settlements', 'absences', 'availability', 'service_blocks', 'swap_requests', 'notifications', 'push_subscriptions', 'push_delivery_logs', 'audit_logs', 'app_settings']
      const ch = supabase.channel(`rbshift-live-${session?.user?.id || 'user'}`)
      realtimeTables.forEach((table) => {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, reloadSoon)
      })
      let rtConnected = false
      ch.subscribe((status) => {
        rtConnected = status === 'SUBSCRIBED'
        if (status === 'SUBSCRIBED') reloadSoon()
      })
      const poll = setInterval(() => { reloadOnline(true) }, 30000)
      const handleOnline = () => reloadOnline(true)
      const handleVisible = () => { if (document.visibilityState !== 'hidden') reloadOnline(true) }
      window.addEventListener('online', handleOnline)
      window.addEventListener('focus', handleOnline)
      document.addEventListener('visibilitychange', handleVisible)
      return () => {
        clearTimeout(timer)
        clearInterval(poll)
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('focus', handleOnline)
        document.removeEventListener('visibilitychange', handleVisible)
        supabase.removeChannel(ch)
      }
    }, [online, session?.user?.id])

    const commit = (updater, text, options = {}) => {
      const prev = dataRef.current
      const rawNext = typeof updater === 'function' ? updater(prev) : updater
      const audit = text ? [{ id: uid('log'), at: new Date().toISOString(), text, actorId: session?.user?.id || null }, ...(rawNext.audit || [])].slice(0, 250) : rawNext.audit
      const next = { ...rawNext, audit }
      dataRef.current = next
      writeStore(next)
      setData(next)
      if (!online) return
      pendingSyncs.current += 1
      setSyncState((s) => ({ ...s, saving: true, error: '' }))
      const pushNotices = addedRows(prev.notifications, next.notifications)
      syncChangedRows(prev, next, profile)
        .then(async () => {
          const freshToken = pushNotices.length ? (await supabase.auth.getSession()).data.session?.access_token || '' : ''
          const pushResult = pushNotices.length ? await sendPushForNotifications(pushNotices, freshToken) : null
          if (pushResult) options.onPushResult?.(pushResult)
          const warning = pushDeliveryWarning(pushResult)
          pendingSyncs.current -= 1
          if (pendingSyncs.current === 0) {
            setSyncState({
              loading: false,
              saving: false,
              error: warning ? `Uloženo, ale push notifikace se nepodařilo doručit: ${warning}` : '',
              lastSyncAt: new Date().toISOString(),
            })
          }
          options.onSuccess?.()
          flushDeferredReload()
        })
        .catch((err) => {
          pendingSyncs.current -= 1
          const shouldRollback = options.rollbackOnError !== false
          if (shouldRollback) {
            dataRef.current = prev
            writeStore(prev)
            setData(prev)
          } else {
            dataRef.current = next
            writeStore(next)
          }
          setSyncState((s) => ({ ...s, saving: false, error: appFriendlyError(err.message || String(err)) }))
          options.onError?.(err)
          flushDeferredReload()
        })
    }

    return [data, commit, syncState, reloadOnline]
  }

  return { useAppData, loadDataFromSupabase, syncChangedRows, seedSupabaseFromLocal }
}
