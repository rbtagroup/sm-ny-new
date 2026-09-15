export const NOTICE_EVENT = 'rbshift:notice'

// Neblokující upozornění místo window.alert; zobrazí ho NoticeToast v aplikaci.
// `undo` přidá tlačítko „Vrátit zpět“, které změnu hned vezme zpět.
export function showNotice(message, { tone = 'warn', undo = null } = {}) {
  if (!message || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: { id: `${Date.now()}-${Math.random()}`, message: String(message), tone, undo: typeof undo === 'function' ? undo : null } }))
}
