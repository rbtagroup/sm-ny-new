function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

export async function showBrowserNotification(title, body = '') {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  await reg.showNotification(title, { body, icon: './icons/notification-icon-192.png', badge: './icons/notification-badge-96.png', tag: `rbshift-${Date.now()}`, data: { url: './' } })
  return true
}

export async function subscribeDeviceForPush(vapidPublicKey) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Push notifikace nejsou v tomto prohlížeči dostupné.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifikace nejsou povolené.')
  const reg = await navigator.serviceWorker.ready
  if (!vapidPublicKey) return { mode: 'local-test-only', permission, endpoint: '' }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) })
  return sub.toJSON()
}
