import Link from 'next/link'
import type { DraftHqAllData, DraftPhase } from '@/lib/core-app/draftHqAll'

/**
 * Draft Season HQ — every league's draft, in one rail.
 *
 * Fed by the cross-league aggregator rather than the per-league loader, so this
 * costs three queries no matter how many leagues the account has.
 *
 * ⚠ AN UNRECOGNISED STATUS IS SHOWN, NOT GUESSED. The draft status vocabulary is
 * inconsistent across the codebase (`complete` and `completed` both exist, plus a
 * provider's `on_clock`/`running`/`live`). When the aggregator cannot place a
 * status it returns `unknown` with the raw value, and this renders that value.
 * Filing a finished draft under "upcoming" would be a confident lie; showing
 * `post_draft_v2` is at least something a reader can act on.
 *
 * ⚠ NO "LOADING" OR EMPTY RAIL. The handoff is explicit: never ship an empty-state
 * draft rail. A league with no draft set up is counted and stated, not rendered
 * as a blank card.
 */

const PHASE_LABEL: Record<DraftPhase, string> = {
  live: 'LIVE',
  upcoming: 'UPCOMING',
  done: 'COMPLETE',
  unknown: 'STATUS UNKNOWN',
}

export function DraftHqAll({ data }: { data: DraftHqAllData | null }) {
  if (!data || data.rows.length === 0) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">
          {data && data.withoutDraft > 0
            ? `No drafts set up yet across your ${data.withoutDraft} ${
                data.withoutDraft === 1 ? 'league' : 'leagues'
              }.`
            : 'No drafts to show yet.'}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="af-d2-rail">
        {data.rows.map((row) => (
          <article key={row.leagueId} className={`af-d2-draft af-d2-draft--${row.phase}`}>
            <div className="af-d2-draft-top">
              <span className={`af-d2-draft-state af-num af-d2-draft-state--${row.phase}`}>
                {row.phase === 'unknown' ? row.rawStatus : PHASE_LABEL[row.phase]}
              </span>
              {row.yourSlot != null ? (
                <span className="af-d2-draft-slot af-num">SLOT {row.yourSlot}</span>
              ) : null}
            </div>

            <div className="af-d2-draft-id">
              {/* The league's own avatar — a wall of identical cards is unreadable
                  when six of them are "TheCiege26's 12-Team NFL Redraft League". */}
              <span className="af-d2-draft-tile" aria-hidden>
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt="" />
                ) : (
                  row.leagueName.trim().slice(0, 2).toUpperCase()
                )}
              </span>
              <h3 className="af-d2-draft-name">{row.leagueName}</h3>
            </div>

            <p className="af-d2-draft-meta af-num">
              {[
                row.teamCount != null ? `${row.teamCount} teams` : null,
                row.rounds != null ? `${row.rounds} rounds` : null,
                row.draftType,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            <p className="af-d2-draft-detail">
              {row.picksMade != null
                ? `${row.picksMade} ${row.picksMade === 1 ? 'pick' : 'picks'} recorded`
                : 'No picks recorded yet'}
              {/* A scheduled time is not stored on the session, so none is shown.
                  The handoff's "TONIGHT 8:00 PM" has no source here. */}
            </p>

            <Link href={`/core/draft-hq?league=${encodeURIComponent(row.leagueId)}`} className="af-d2-draft-cta">
              Open draft
            </Link>
          </article>
        ))}
      </div>

      {data.withoutDraft > 0 ? (
        <p className="af-d2-rail-foot">
          {data.withoutDraft} {data.withoutDraft === 1 ? 'league has' : 'leagues have'} no
          draft set up.
        </p>
      ) : null}
    </>
  )
}

export default DraftHqAll
