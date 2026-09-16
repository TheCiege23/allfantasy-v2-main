'use client'

import { useCallback } from 'react'

/**
 * Downloads the league's dated events as an .ics file.
 *
 * The file is built on the server (`buildIcs`) and handed down as text, so the
 * export is exactly what the calendar on screen shows — no second route, and no
 * client-side re-derivation of dates.
 */
export function CalendarExportButton({ ics, leagueName }: { ics: string; leagueName: string }) {
  const download = useCallback(() => {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${leagueName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-calendar.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoke on the next tick; Safari cancels a download whose URL is revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [ics, leagueName])

  return (
    <button type="button" className="af-btn af-ch-ics" onClick={download}>
      Add to calendar (.ics)
    </button>
  )
}
