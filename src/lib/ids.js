export const uid = (prefix = 'id') => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11)}`
