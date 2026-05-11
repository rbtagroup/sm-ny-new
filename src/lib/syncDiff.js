const normalizeForFingerprint = (value) => {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      if (value[key] !== undefined) acc[key] = normalizeForFingerprint(value[key])
      return acc
    }, {})
}

export const stableFingerprint = (value) => JSON.stringify(normalizeForFingerprint(value))

export function changedRows(prevList = [], nextList = []) {
  const prev = new Map((prevList || []).map((x) => [x.id, stableFingerprint(x)]))
  return (nextList || []).filter((x) => x?.id && (!prev.has(x.id) || prev.get(x.id) !== stableFingerprint(x)))
}

export function addedRows(prevList = [], nextList = []) {
  const prevIds = new Set((prevList || []).map((x) => x.id))
  return (nextList || []).filter((x) => x?.id && !prevIds.has(x.id))
}
