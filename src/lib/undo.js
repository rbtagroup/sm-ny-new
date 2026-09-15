// Taking back a quick change: records it changed or removed return as they were before, records it added go away.
// Everything else, including what others changed in the meantime, stays as it is.
export function restoreRecords(data = {}, key, before = [], addedIds = []) {
  const added = new Set(addedIds)
  const previous = new Map(before.map((record) => [record.id, record]))
  const kept = (data[key] || []).filter((record) => !added.has(record.id)).map((record) => previous.get(record.id) || record)
  const present = new Set(kept.map((record) => record.id))
  return { ...data, [key]: [...before.filter((record) => !present.has(record.id)), ...kept] }
}

// Several collections at once: [{ key: 'shifts', before: [shift] }, { key: 'notifications', addedIds: [noticeId] }].
export function takeBackChange(data = {}, changes = []) {
  return changes.reduce((current, { key, before = [], addedIds = [] }) => restoreRecords(current, key, before, addedIds), data)
}
