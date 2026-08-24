import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-drafts.css'
import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'

/**
 * Drafts on the clock — the band that LEADS the /core home whenever the
 * account has a live draft. Fed by getDraftHqAll, the cross-league aggregator
 * (three set-based queries no matter how many leagues), never the per-league
 * loader in a loop.
 *
 * Render-nothing rules, all deliberate:
 *  - null data (the read failed)  → nothing. A home that cannot read drafts
 *    must not claim there are none — and must not lead with an error card
 *    on the one screen everyone lands on.
 *  - zero live-phase rows         → nothing. Upcoming and finished drafts
 *    have their own home in Draft HQ; this band exists only for "a draft is
 *    running RIGHT NOW", and an empty urgency band is noise.
 *
 * Honesty rules:
 *  - The status chip shows the ROW'S raw status, not a flattened "LIVE".
 *    getDraftHqAll's live bucket deliberately includes `paused` — a paused
 *    draft in a band that says LIVE would be a confident lie, so the chip
 *    says PAUSED.
 *  - pickExpiresAt absent renders "no pick timer reported", never an
 *    invented countdown. Present, it renders a COARSE server paint (minutes,
 *    like the first-kickoff band's static countdown) — no client ticking.
 *  - yourSlot is shown only when the aggregator resolved your team into the
 *    slot order. "Whose pick it is" is NOT rendered at all: the aggregator
 *    does not compute it, and deriving it from picksMade % teamCount would
 *    be snake-draft math applied to drafts that may not be snakes.
 *
 * A separate component beside Dash3ATriage/Dash34Carryover/DashUserOs because
 * Dashboard3A.tsx carries another session's in-flight work and is not edited.
 */

const VISIBLE_CAP = 4

function prettyStatus(raw: string): string {
  const s = raw.trim().replace(/_/g, ' ').toUpperCase()
  return s.length > 0 ? s : 'LIVE'
}

/**
 * Coarse pick-clock label from a millisecond delta. Server paint only — the
 * page does not tick, so seconds precision would just be precisely stale.
 */
function formatPickClock(ms: number): string {
  if (ms <= 0) return 'Pick timer expired'
  if (ms < 60_000) return 'Under 1 min on the pick clock'
  const totalMins = Math.floor(ms / 60_000)
  if (totalMins < 60) return `${totalMins} min on the pick clock`
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  return `${hours}h ${String(mins).padStart(2, '0')}m on the pick clock`
}

function pickClockOf(row: DraftHqAllRow, now: Date): string | null {
  if (!row.pickExpiresAt) return null
  const t = new Date(row.pickExpiresAt).getTime()
  if (Number.isNaN(t)) return null
  return formatPickClock(t - now.getTime())
}

export function DashDraftsBand({ data, now }: { data: DraftHqAllData | null; now: Date }) {
  if (!data) return null
  const live = data.rows.filter((r) => r.phase === 'live')
  if (live.length === 0) return null

  const visible = live.slice(0, VISIBLE_CAP)
  const overflow = live.length - visible.length

  return (
    <section className="af-core af-drafts" aria-label="Drafts on the clock">
      <div className="af-drafts-head">
        <span className="af-label af-drafts-kicker">Drafts on the clock</span>
        <span className="af-drafts-count af-num">
          {live.length === 1 ? '1 draft live now' : `${live.length} drafts live now`}
        </span>
      </div>

      <div className="af-drafts-grid">
        {visible.map((row) => {
          const clock = pickClockOf(row, now)
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
                <span className="af-drafts-state af-num">{prettyStatus(row.rawStatus)}</span>
              </div>

              <p className="af-drafts-meta af-num">
                {[
                  row.yourSlot != null ? `Your slot ${row.yourSlot}` : null,
                  row.picksMade != null
                    ? `${row.picksMade} ${row.picksMade === 1 ? 'pick' : 'picks'} made`
                    : 'No picks recorded yet',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              <p className="af-drafts-clock af-num" data-known={clock ? 'true' : 'false'}>
                {clock ?? 'On the clock — no pick timer reported'}
              </p>

              <Link
                className="af-drafts-open"
                href={`/core/draft-hq?league=${encodeURIComponent(row.leagueId)}`}
              >
                Open draft room
              </Link>
            </article>
          )
        })}
      </div>

      {overflow > 0 ? (
        <Link className="af-drafts-more" href="/core/draft-hq">
          +{overflow} more in Draft HQ
        </Link>
      ) : null}
    </section>
  )
}
