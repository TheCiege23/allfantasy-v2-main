import type { LiveEvent } from '@/lib/live/eventDetector'

/**
 * The live play feed — what just happened, with the player it happened to.
 *
 * ⚠ THE DESCRIPTION IS THE PROVIDER'S OWN SENTENCE, NOT ONE WE ASSEMBLE.
 * `LiveEvent.detail` carries play-by-play's `description` ("J.Cook rushed up the
 * middle for 4 yards"), which is already accurate, already handles laterals and
 * penalties, and cannot drift from what actually happened. Rebuilding that
 * sentence from `stat` and `delta` would be inventing prose about a real play —
 * and getting a lateral or a reversed call wrong in public.
 *
 * ⚠ FANTASY POINTS ARE NOT SHOWN, AND THAT IS DELIBERATE. The handoff asks for
 * "because they are TE premium that scored you X points". That number is real
 * only under a specific league's scoring, and this feed is cross-league — the
 * same catch is worth different points in each league the player is rostered in.
 * A single figure here would be right for at most one of them. It belongs on the
 * league-scoped surface where the scoring settings are known, next to
 * `LeagueImpact.afPoints` which already computes exactly that.
 */

const TYPE_LABEL: Record<string, string> = {
  TOUCHDOWN: 'TD',
  BIG_PLAY: 'BIG PLAY',
  TURNOVER: 'TURNOVER',
  FIELD_GOAL: 'FG',
  DEFENSIVE_SCORE: 'DEF TD',
  SPECIAL_TEAMS_SCORE: 'ST TD',
}

/** Tone follows the semantic contract: a score is good, a turnover costs you. */
function toneOf(type: string): 'good' | 'bad' | 'warn' {
  if (type === 'TURNOVER') return 'bad'
  if (type === 'BIG_PLAY') return 'warn'
  return 'good'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

export function LivePlays({
  events,
  imagesByPlayerId = {},
}: {
  events: LiveEvent[]
  /** Headshots, keyed by the provider's player id. Absent is normal. */
  imagesByPlayerId?: Record<string, string | null>
}) {
  if (events.length === 0) {
    return (
      <div className="af-d2-card">
        {/*
          "Nothing has happened yet" and "we are not watching" are different
          claims. This says the first one, which is the true one whenever no game
          is in progress — the poller only fills this while games are live.
        */}
        <p className="af-d2-empty">
          No plays yet. Scoring plays and big gains appear here while your
          players&rsquo; games are being played.
        </p>
      </div>
    )
  }

  return (
    <div className="af-d2-card">
      <ul className="af-d2-plays">
        {events.map((ev) => {
          const img = imagesByPlayerId[ev.playerId] ?? null
          return (
            /* Keyed on idempotencyKey — the same key the feed dedupes on, so a
               re-render after a poll cannot duplicate a row. */
            <li key={ev.idempotencyKey} className="af-d2-play" data-tone={toneOf(ev.type)}>
              <span className="af-d2-play-img" aria-hidden>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" loading="lazy" />
                ) : (
                  initials(ev.playerName)
                )}
              </span>

              <span className="af-d2-play-text">
                <span className="af-d2-play-head">
                  <span className="af-d2-play-name">{ev.playerName}</span>
                  {ev.team ? <span className="af-d2-play-team af-num">{ev.team}</span> : null}
                  <span className="af-d2-play-type af-num" data-tone={toneOf(ev.type)}>
                    {TYPE_LABEL[ev.type] ?? ev.type}
                  </span>
                </span>
                {/* The provider's sentence, verbatim. */}
                <span className="af-d2-play-detail">{ev.detail}</span>
              </span>

              {/* Yards, when the play gained any. A 0 is omitted rather than
                  printed — a touchdown from the 1 is not "0 yards" worth noting. */}
              {ev.delta > 0 ? (
                <span className="af-d2-play-yards af-num">+{ev.delta}</span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default LivePlays
