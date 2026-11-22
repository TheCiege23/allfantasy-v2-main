'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { screenGuide, screenGuideKeyFor } from '@/lib/core-app/screenGuides'
import { OPEN_HOW_IT_WORKS_EVENT, screenGuideMessages } from '@/lib/core-app/messages/screenGuide'
import '@/components/core-app/screen-guide.css'

const SEEN_PREFIX = 'af-screen-guide-v1:'
/** CoreWelcomeTour's key. While the tour is still showing on Home, the strip does not open on top of it. */
const WELCOME_TOUR_KEY = 'af-core-welcome-v1'

/**
 * "What's this page?" — the strip at the top of every /core screen (2026-11-20).
 *
 * The first time someone opens a page it is OPEN: what the page is for, up to three things to do,
 * and where to start. "Got it" folds it to one line and remembers that per page, so a regular
 * reader sees a single quiet line and the screen's own headline stays first. The line reopens it.
 *
 * ⚠ CLOSED ON THE SERVER, OPENED IN AN EFFECT. localStorage does not exist on the server, so the
 * first paint is always the folded line; opening it in render would be a hydration mismatch.
 *
 * ⚠ ONE KEY PER PAGE, NOT ONE FOR THE WHOLE APP. A reader who has learned My team has not learned
 * Waivers, and the complaint was about pages nobody had explained.
 */
export function ScreenGuide({ path }: { path?: string } = {}) {
  const t = useMessages(screenGuideMessages)
  const { language } = useOptionalLanguage()
  const pathname = usePathname()
  const params = useSearchParams()
  const inLeague = Boolean(params?.get('league'))
  const key = screenGuideKeyFor(path ?? pathname, inLeague)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!key) return
    try {
      const seen = window.localStorage.getItem(SEEN_PREFIX + key) === 'seen'
      const tourShowing = key === 'home' && window.localStorage.getItem(WELCOME_TOUR_KEY) !== 'done'
      setOpen(!seen && !tourShowing)
    } catch {
      // Storage refused (private mode): stay folded rather than reopening on every visit.
      setOpen(false)
    }
  }, [key])

  if (!key) return null
  const guide = screenGuide(key, language)
  const panelId = `af-sg-panel-${key}`

  function markSeen() {
    try { window.localStorage.setItem(SEEN_PREFIX + key, 'seen') } catch {}
  }
  function close() {
    markSeen()
    setOpen(false)
  }
  function openEveryPage() {
    window.dispatchEvent(new Event(OPEN_HOW_IT_WORKS_EVENT))
  }

  return (
    <section className="af-sg" data-open={open} data-testid="screen-guide" data-guide={key} aria-label={t.whatsThis}>
      <button
        type="button"
        className="af-sg-line"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="af-sg-mark" aria-hidden>?</span>
        <span className="af-sg-label">{t.whatsThis}</span>
        <span className="af-sg-what">{guide.what}</span>
        <span className="af-sg-toggle" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      <div id={panelId} className="af-sg-panel" hidden={!open}>
        <p className="af-sg-can-title">{t.youCan}</p>
        <ul className="af-sg-can">
          {guide.can.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="af-sg-start"><b>{t.startHere}</b> {guide.start}</p>
        <div className="af-sg-actions">
          <button type="button" className="af-sg-secondary" onClick={openEveryPage}>{t.everyPage}</button>
          <button type="button" className="af-sg-primary" onClick={close}>{t.gotIt}</button>
        </div>
      </div>
    </section>
  )
}
