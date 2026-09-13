import test from 'node:test'
import assert from 'node:assert/strict'
import { coverageGapSignature, coverageNoticeDecision, daysBetweenISO } from '../supabase/functions/scheduler/coverageNotice.js'

const gap = (day, slotId = 'cov_day', missing = 1) => ({ day, slotId, missing })

test('daily coverage notices only cover the next 48 hours', () => {
  assert.equal(daysBetweenISO('2026-09-13', '2026-09-15'), 2)

  const later = coverageNoticeDecision({ gaps: [gap('2026-09-16')], today: '2026-09-13' })
  assert.equal(later.notify, false)
  assert.equal(later.reason, 'no-gaps-within-48h')

  const soon = coverageNoticeDecision({ gaps: [gap('2026-09-13'), gap('2026-09-14', 'cov_night'), gap('2026-09-18')], today: '2026-09-13' })
  assert.equal(soon.notify, true)
  assert.equal(soon.upcomingGaps.length, 2)

  assert.equal(coverageNoticeDecision({ gaps: [], today: '2026-09-13' }).reason, 'no-missing-coverage')
})

test('unchanged upcoming gaps are repeated at most every three days', () => {
  const today = '2026-09-13'
  const gaps = [gap('2026-09-13'), gap('2026-09-14')]
  const signature = coverageGapSignature(gaps, today)
  const notifiedDaysAgo = (days) => ({ created_at: new Date(Date.parse('2026-09-13T05:00:00Z') - days * 86_400_000).toISOString(), payload: { upcomingSignature: signature } })

  assert.equal(coverageNoticeDecision({ gaps, today, now: '2026-09-13T05:00:02Z', lastNotified: notifiedDaysAgo(1) }).reason, 'unchanged-upcoming-gaps')
  assert.equal(coverageNoticeDecision({ gaps, today, now: '2026-09-13T05:00:02Z', lastNotified: notifiedDaysAgo(3) }).notify, true)

  const changed = coverageNoticeDecision({ gaps: [gap('2026-09-13', 'cov_day', 2)], today, now: '2026-09-13T05:00:02Z', lastNotified: notifiedDaysAgo(1) })
  assert.equal(changed.notify, true, 'a different gap situation is announced immediately')
})
