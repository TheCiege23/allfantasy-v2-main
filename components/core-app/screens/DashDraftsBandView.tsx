'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { dashDraftsBandMessages } from '@/lib/core-app/messages/dashDraftsBand'

/**
 * The words of DashDraftsBand, in the reader's language (2026-10-04).
 *
 * The band is a SERVER component and the language is client state, so the band decides WHAT to say —
 * which drafts are live, and how long is left on each pick clock against the server's `now` — and this
 * says it. Copied from DashScheduleBand → DashScheduleBandView (#2043).
 *
 * ⚠ ONLY SLICES CROSS THE BOUNDARY: each card gets the fields it shows, never the aggregator's row.
 */
export type DraftsBandCard = {
  leagueId: string
  leagueName: string
  imageUrl: string | null
  /** The row's own status, straight from the draft ("drafting", "paused") — see the band's honesty rules. */
  rawStatus: string
  yourSlot: number | null
  picksMade: number | null
  /** Milliseconds left on the pick clock at the server's `now`; null when no timer is reported. */
  clockMs: number | null
}

/** Draft statuses the shared table does not hold; the rest go through `coreUiCopy` ("paused", "in progress"). */
const STATUS_ES: Record<string, string> = { drafting: 'en curso', live: 'en vivo' }

type DraftsMessages = typeof dashDraftsBandMessages.en

function statusText(raw: string, es: boolean, m: DraftsMessages): string {
  const s = raw.trim().replace(/_/g, ' ')
  if (s.length === 0) return m.live
  if (!es) return s.toUpperCase()
  const key = s.toLowerCase()
  return (STATUS_ES[key] ?? coreUiCopy(key, 'es')).toUpperCase()
}

/** Coarse pick-clock label. Server paint only — the page does not tick, so seconds would be precisely stale. */
function pickClockText(ms: number, m: DraftsMessages): string {
  if (ms <= 0) return m.pickTimerExpired
  if (ms < 60_000) return m.underOneMin
  const totalMins = Math.floor(ms / 60_000)
  if (totalMins < 60) return m.minsOnClock(totalMins)
  const hours = Math.floor(totalMins / 60)
  const mins = String(totalMins % 60).padStart(2, '0')
  return m.hoursOnClock(hours, mins)
}

export function DashDraftsBandView({ liveCount, visible, overflow }: { liveCount: number; visible: DraftsBandCard[]; overflow: number }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const m = useMessages(dashDraftsBandMessages)

  return (
    <section className="af-core af-drafts" aria-label={m.title}>
      <div className="af-drafts-head">
        <span className="af-label af-drafts-kicker">{m.title}</span>
        <span className="af-drafts-count af-num">
          {liveCount === 1 ? m.oneDraftLive : m.draftsLive(liveCount)}
        </span>
      </div>

      <div className="af-drafts-grid">
        {visible.map((row) => {
          const clock = row.clockMs != null ? pickClockText(row.clockMs, m) : null
          return (
            <article key={row.leagueId} className="af-drafts-card">
              <div className="af-drafts-id">
                {/* The league's own avatar — six live cards named "…12-Team NFL
                    Redraft League" are unreadable without one. Missing avatar
                    renders the name's initials, not a broken image. */}
                <span className="af-drafts-tile" aria-hidden>
                  {row.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.imageUrl} alt="" />
                  ) : (
                    row.leagueName.trim().slice(0, 2).toUpperCase()
                  )}
                </span>
                <h3 className="af-drafts-name">{row.leagueName}</h3>
                <span className="af-drafts-state af-num">{statusText(row.rawStatus, es, m)}</span>
              </div>

              <p className="af-drafts-meta af-num">
                {[
                  row.yourSlot != null ? m.yourSlot(row.yourSlot) : null,
                  row.picksMade != null ? m.picksMade(row.picksMade) : m.noPicks,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              <p className="af-drafts-clock af-num" data-known={clock ? 'true' : 'false'}>
                {clock ?? m.noTimer}
              </p>

              <Link className="af-drafts-open" href={`/core/draft-hq?league=${encodeURIComponent(row.leagueId)}`}>
                {m.openDraftRoom}
              </Link>
            </article>
          )
        })}
      </div>

      {overflow > 0 ? (
        <Link className="af-drafts-more" href="/core/draft-hq">
          {m.moreInDraftHq(overflow)}
        </Link>
      ) : null}
    </section>
  )
}

export default DashDraftsBandView
