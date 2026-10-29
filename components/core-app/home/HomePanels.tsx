'use client'

import { ScopeResetLink } from '@/components/core-app/ScopeSwitcher'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { homePanelsMessages } from '@/lib/core-app/messages/homePanels'
import { scopeLabelText } from '@/lib/core-app/shellCopy'

/**
 * HomeCards' own words, in the reader's language (2026-10-04): the filtered home's note, the panel for
 * a filter that matches nothing, and the "could not read your leagues" panel. HomeCards is a SERVER
 * component and the language is client state, so it decides which panel to show and these say it. The
 * scope label ("NFL leagues") goes through shellCopy's `scopeLabelText`, as it does in the switcher.
 */

/** A filtered home says so above everything, with the way back to every league. */
export function HomeScopeNote({ label, count, total }: { label: string; count: number; total: number }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(homePanelsMessages)
  /* scopeLabelText returns the label unchanged outside Spanish, so this is the English as it was. */
  return (
    <p className="af-home-scope" role="status">
      <span>
        {m.showing}
        <b>{scopeLabelText(label, language)}</b>
        {m.scopeCount(count, total)}
      </span>
      <ScopeResetLink>{m.showAllLeagues}</ScopeResetLink>
    </p>
  )
}

/**
 * A scope that matches nothing — a sport or platform you no longer play, favorites on a new device.
 * Said plainly, rather than rendering a home of cards that each claim "nothing here" about leagues
 * that were simply filtered out.
 */
export function HomeScopeEmpty({ label, scopeKey }: { label: string; scopeKey: string }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(homePanelsMessages)
  return (
    <div className="af-frame af-home-scope-empty">
      <h2>{m.noLeaguesInView}</h2>
      <p>
        {m.noneMatch(scopeLabelText(label, language))}
        {scopeKey === 'fav' ? m.favHint : ''}.{' '}
        <ScopeResetLink>{m.showAllLeagues}</ScopeResetLink>
      </p>
    </div>
  )
}

/**
 * The panel that used to replace the whole home when the summary read failed — see HomeCards' header.
 * It says the read failed, never that there are no leagues.
 */
export function HomeReadFailure() {
  const m = useMessages(homePanelsMessages)
  return (
    <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
      <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
        {m.yourLeagues}
      </h1>
      <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
        {m.readFailure}
      </p>
    </div>
  )
}

/**
 * The foot of the home: the way to switch sections off (Settings → Home page, 2026-10-24). When some
 * are already off it says how many, so a missing card reads as the reader's own choice rather than
 * as something broken — and the same link brings it back.
 */
export function HomeCustomizeLink({ hiddenCount }: { hiddenCount: number }) {
  const m = useMessages(homePanelsMessages)
  const text = hiddenCount > 0 ? m.sectionsHidden(hiddenCount) : m.tooMuch
  return (
    <p className="af-home-customize">
      <a href="/settings?tab=home" data-testid="home-customize-link">
        {text}
      </a>
    </p>
  )
}
