'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { WelcomeBackView } from '@/lib/inactive-manager/welcomeBackService'

const DISMISS_PREFIX = 'af-welcome-back-dismissed:'

/**
 * "Welcome back" on the lineup screen (lib/inactive-manager/welcomeBack.ts): after AllFantasy ran the
 * team, the owner's first visit in the next week shows what was done while they were away. Dismissing
 * it is remembered on this device only — the same summary is also in their notifications.
 */
export function WelcomeBackCard({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const [view, setView] = useState<WelcomeBackView | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/welcome-back`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { welcomeBack: WelcomeBackView | null } | null) => {
        if (!live || !body?.welcomeBack) return
        let dismissed = false
        try {
          dismissed = window.localStorage.getItem(DISMISS_PREFIX + body.welcomeBack.id) === '1'
        } catch {}
        if (!dismissed) setView(body.welcomeBack)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [leagueId])

  if (!view || hidden) return null
  const text = es ? view.summary.es : view.summary.en
  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_PREFIX + view.id, '1')
    } catch {}
    setHidden(true)
  }
  return (
    <section className="nls-card" data-testid="welcome-back" aria-label={es ? 'Hola de nuevo' : 'Welcome back'}>
      <p>
        <strong>{text.headline}</strong>
      </p>
      {text.lines.length ? (
        <ul>
          {text.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      <p className="nls-muted">{es ? 'Tu equipo vuelve a ser tuyo: AllFantasy ya no cambia tu alineación.' : 'Your team is yours again: AllFantasy no longer sets your lineup.'}</p>
      {text.claimsNote ? <p className="nls-muted">{text.claimsNote}</p> : null}
      <button type="button" className="af-btn" onClick={dismiss} data-testid="welcome-back-dismiss">
        {es ? 'Entendido' : 'Got it'}
      </button>
    </section>
  )
}
