// Kdy poslat dispečinku denní upozornění na chybějící obsazení.
export const NOTIFY_WINDOW_DAYS = 2
export const REPEAT_UNCHANGED_AFTER_DAYS = 3

export function daysBetweenISO(fromISO, toISO) {
  const [y1, m1, d1] = String(fromISO).split('-').map(Number)
  const [y2, m2, d2] = String(toISO).split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

export function upcomingCoverageGaps(gaps = [], today) {
  return gaps.filter((gap) => {
    const offset = daysBetweenISO(today, gap.day)
    return offset >= 0 && offset < NOTIFY_WINDOW_DAYS
  })
}

// Podpis počítá dny od dneška, takže se nemění, dokud je situace pořád stejná.
export function coverageGapSignature(gaps = [], today) {
  return gaps
    .map((gap) => `${daysBetweenISO(today, gap.day)}|${gap.slotId}|${gap.missing}`)
    .sort()
    .join(',')
}

export function coverageNoticeDecision({ gaps = [], today, now = new Date().toISOString(), lastNotified = null } = {}) {
  if (!gaps.length) return { notify: false, reason: 'no-missing-coverage', upcomingGaps: [], signature: '' }

  const upcomingGaps = upcomingCoverageGaps(gaps, today)
  const signature = coverageGapSignature(upcomingGaps, today)
  if (!upcomingGaps.length) return { notify: false, reason: 'no-gaps-within-48h', upcomingGaps, signature }

  const lastSignature = lastNotified?.payload?.upcomingSignature
  const lastAt = Date.parse(lastNotified?.created_at || '') || 0
  const daysSinceLastNotice = (Date.parse(now) - lastAt) / 86_400_000
  if (lastSignature === signature && daysSinceLastNotice < REPEAT_UNCHANGED_AFTER_DAYS - 0.1) {
    return { notify: false, reason: 'unchanged-upcoming-gaps', upcomingGaps, signature }
  }

  return { notify: true, reason: '', upcomingGaps, signature }
}
