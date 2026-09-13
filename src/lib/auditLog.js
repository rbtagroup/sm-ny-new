// The scheduler used to log every cron call it skipped outside the Prague morning window; these rows say nothing to dispatch.
export function isRoutineSchedulerLog(log = {}) {
  return /^Scheduler daily-coverage skipped outside Prague window\.?$/.test(String(log?.text || log?.action || '').trim())
}
