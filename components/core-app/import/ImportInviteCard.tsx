'use client'

/**
 * "Bring your leaguemates" — shown once an import finishes.
 *
 * ⚠ THERE IS NO SEPARATE INVITE SYSTEM FOR AN IMPORTED LEAGUE, AND THIS DOES NOT INVENT ONE.
 * A leaguemate joins an imported league by importing the same league themselves:
 * `claimExistingLeagueForMember` (ImportedLeagueCommitService) recognises the league another account
 * already brought in and attaches them to THEIR team, matched on the provider's own manager id —
 * never on anything this card sends. So the invite is simply a deep link to /import pointed at the
 * league: `?provider=&leagueId=` survives the sign-in redirect (app/import/page.tsx) and opens that
 * league's preview on arrival. Whatever gate the platform needs (ESPN cookies, a Sleeper account)
 * is the same gate the importer passed, with the same guide beside it.
 *
 * Why it exists: "the import starts with only you and every leaguemate has to be re-invited by
 * hand" was one of the recurring complaints in the 2026-11-06 research pass.
 */

import { useEffect, useState } from 'react'

import { smsInviteHref, whatsAppInviteHref } from '@/lib/league/league-invite-link'
import type { ImportProvider } from '@/lib/league-import/types'

export function importInviteUrl(provider: ImportProvider, sourceId: string, origin: string): string {
  const qs = new URLSearchParams({ provider, leagueId: sourceId })
  return `${origin.replace(/\/$/, '')}/import?${qs.toString()}`
}

export type ImportInviteCardProps = {
  provider: ImportProvider
  providerLabel: string
  sourceId: string
  leagueName: string
}

export function ImportInviteCard({ provider, providerLabel, sourceId, leagueName }: ImportInviteCardProps) {
  const [origin, setOrigin] = useState('https://allfantasy.ai')
  const [copied, setCopied] = useState(false)
  const [canShare, setCanShare] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location?.origin) setOrigin(window.location.origin)
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  const url = importInviteUrl(provider, sourceId, origin)
  const message = `Our league "${leagueName}" is on AllFantasy — open this and sign in to import it with your own team:`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="af-im-card af-im-card--invite" aria-labelledby="af-im-invite-h" data-testid="import-invite-card">
      <header className="af-im-preview-head">
        <span className="af-im-invite-mark" aria-hidden>
          +
        </span>
        <span className="af-label">Bring your leaguemates</span>
      </header>
      <h2 id="af-im-invite-h" className="af-im-invite-title">
        Everyone in {leagueName} gets their own view.
      </h2>
      <p className="af-im-field-help">
        Send them this link. They sign in and import the same league; once {providerLabel} confirms
        they&rsquo;re in it, we put them on their own team in this copy instead of making a second
        one. Nothing changes on {providerLabel}.
      </p>
      <div className="af-im-invite-link">
        <code className="af-im-invite-url" data-testid="import-invite-url">
          {url}
        </code>
        <button type="button" className="af-im-invite-copy" onClick={() => void copy()}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
      <div className="af-im-invite-actions">
        {canShare ? (
          <button
            type="button"
            className="af-btn af-im-submit"
            onClick={() => {
              void navigator.share({ title: leagueName, text: message, url }).catch(() => undefined)
            }}
          >
            Share
          </button>
        ) : null}
        <a className="af-btn af-btn--ghost" href={smsInviteHref(message, url)}>
          Text it
        </a>
        <a className="af-btn af-btn--ghost" href={whatsAppInviteHref(message, url)} target="_blank" rel="noreferrer noopener">
          WhatsApp
        </a>
      </div>
    </section>
  )
}

export default ImportInviteCard
