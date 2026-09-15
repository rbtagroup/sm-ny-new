import { useEffect, useState } from 'react'
import { appFriendlyError } from './lib/errors.js'
import { showBrowserNotification, subscribeDeviceForPush } from './lib/pushClient.js'

const readPermission = () => ('Notification' in window ? Notification.permission : 'unsupported')
const readStandalone = () => Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true)

// Push notifications on this device: browser support, permission, the stored device record and switching them on.
export function usePushDevice({ data, commit, currentDriver, isDriver, profile, services }) {
  const { uid } = services
  const [permission, setPermission] = useState(readPermission)
  const [isStandalone, setIsStandalone] = useState(readStandalone)
  // null until the browser says which subscription this device has
  const [currentEndpoint, setCurrentEndpoint] = useState(null)
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setCurrentEndpoint(''); return }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setCurrentEndpoint(sub?.endpoint || ''))
      .catch(() => setCurrentEndpoint(''))
  }, [permission])

  useEffect(() => {
    const media = window.matchMedia?.('(display-mode: standalone)')
    if (!media) return undefined
    const update = () => setIsStandalone(Boolean(media.matches || window.navigator?.standalone === true))
    update()
    if (media.addEventListener) {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener?.(update)
    return () => media.removeListener?.(update)
  }, [])

  const supported = 'serviceWorker' in navigator && 'Notification' in window
  const pushSupported = 'PushManager' in window
  const myDevices = isDriver
    ? (data.pushSubscriptions || []).filter((device) => device.driverId === currentDriver?.id && currentEndpoint !== null && device.endpoint === currentEndpoint)
    : (data.pushSubscriptions || []).filter((device) => device.profileId === profile?.id || device.role === profile?.role)
  const activeDevices = myDevices.filter((device) => device.active !== false)
  const isIosLike = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  const enable = async () => {
    try {
      const sub = await subscribeDeviceForPush(vapidPublicKey)
      const record = { id: uid('push'), profileId: profile?.id || '', driverId: isDriver ? currentDriver?.id || '' : '', role: isDriver ? 'driver' : (profile?.role || 'admin'), endpoint: sub.endpoint || '', subscription: sub, platform: navigator.userAgent, createdAt: new Date().toISOString(), active: true }
      commit((prev) => ({ ...prev, pushSubscriptions: [record, ...(prev.pushSubscriptions || []).filter((item) => item.endpoint !== record.endpoint)] }), 'Zařízení povolilo notifikace.')
      setPermission('granted')
      setCurrentEndpoint(record.endpoint)
      await showBrowserNotification('RBSHIFT notifikace aktivní', 'Test notifikace proběhl v pořádku.')
      return { ok: true, message: sub.endpoint ? 'Zařízení je přihlášené k push notifikacím.' : 'Notifikace jsou povolené, ale server je na toto zařízení zatím neumí posílat.' }
    } catch (err) {
      setPermission(readPermission())
      return { ok: false, message: appFriendlyError(err?.message || 'Notifikace se nepodařilo povolit.') }
    }
  }

  return { permission, setPermission, isStandalone, currentEndpoint, supported, pushSupported, vapidPublicKey, myDevices, activeDevices, isIosLike, enable }
}
