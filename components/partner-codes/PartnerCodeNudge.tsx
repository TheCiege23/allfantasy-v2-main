'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePartnerNudge } from '@/components/partner-codes/usePartnerNudge'
import './partner-nudge.css'

/*
 * The home-page door to Partner Codes. Commissioners only (and anyone who already
 * has a code), and only while the program is on: the server decides both, so a
 * regular player never sees it and costs one small request.
 *
 *   variant="row"  — a line inside "Leagues you run" on the /core home
 *   variant="card" — a standalone card (the dashboard-v2 screen)
 *
 * "Not now" hides it for 30 days. The account menu's "Partner Code" item stays,
 * so hiding the nudge never hides the program.
 */
const DISMISS_KEY = 'af-partner-card-dismissed-at'
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000

export function PartnerCodeNudge({ variant = 'card' }: { variant?: 'row' | 'card' }) {
  const nudge = usePartnerNudge()
  // Hidden until localStorage is read, so a dismissed nudge never flashes in.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      const at = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0)
      setDismissed(at > 0 && Date.now() - at < DISMISS_MS)
    } catch {
      setDismissed(false)
    }
  }, [])

  if (!nudge?.show || dismissed) return null

  const hide = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* private mode: hidden for this visit only */
    }
  }

  return (
    <div className="af-pc-nudge" data-variant={variant} role="region" aria-labelledby={`af-pc-nudge-${variant}`}>
      <div className="af-pc-nudge-text">
        <span className="af-pc-nudge-kicker">PARTNER CODE</span>
        <p id={`af-pc-nudge-${variant}`} className="af-pc-nudge-title">{nudge.title}</p>
        <p className="af-pc-nudge-body">{nudge.body}</p>
      </div>
      <div className="af-pc-nudge-actions">
        <Link href="/partner-code" className="af-pc-nudge-cta">
          {nudge.action}
        </Link>
        <button type="button" className="af-pc-nudge-dismiss" onClick={hide} aria-label="Hide this for 30 days">
          Not now
        </button>
      </div>
    </div>
  )
}
