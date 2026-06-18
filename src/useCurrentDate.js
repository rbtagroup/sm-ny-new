import { useEffect, useState } from 'react'
import { millisecondsUntilNextLocalDay, todayISO } from './lib/dateTime.js'

export function useCurrentDate() {
  const [today, setToday] = useState(() => todayISO())

  useEffect(() => {
    let timer
    const refresh = () => setToday(todayISO())
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        refresh()
        schedule()
      }, millisecondsUntilNextLocalDay())
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') refresh()
    }

    schedule()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  return today
}
