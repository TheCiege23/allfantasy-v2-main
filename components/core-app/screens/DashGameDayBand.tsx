import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-gameday.css'
import type { PlayFeedItem } from '@/lib/live/playFeedPresentation'
import type { TodayStripData } from '@/lib/core-app/todayStrip'
import { DashGameDayBandView } from '@/components/core-app/screens/DashGameDayBandView'

/**
 * Game day — the band that only exists while games are being played.
 *
 * ⚠ THE HOME HAD NOTHING FOR SUNDAY AFTERNOON. Before kickoff the first-lock
 * band counts down and the triage strip names the starters who cannot play;
 * once the slate starts, both go quiet and the screen a 61-league manager sits
 * in for six hours had nothing that moved. The two loaders for it were already
 * built, already honest, and mounted only on the unused dashboard-v2 segment.
 *
 * ⚠ IT RENDERS ONLY INSIDE A REGULAR-SEASON GAME WINDOW, AND THAT IS THE
 * WHOLE DESIGN. A live-looking band on a Tuesday, or during a preseason game
 * nobody's lineup scores, is the "players with no meaning" problem again.
 *
 * Two gates, and the first one was missing when this shipped: the regular
 * season must actually have kicked off (`hasRegularSeasonStarted`), because
 * preseason football produces perfectly real plays that score nobody's lineup
 * — the band claimed this rule in prose and did not enforce it. Then there
 * must be evidence football is happening to THIS account: a play detected in
 * the last few hours (the poller only fills that feed while games are live),
 * or a today's record, which exists only when live matchups are being scored.
 * Any gate unmet → the band does not exist. Most of the week that is right.
 *
 * ⚠ THE FEED IS LEAGUE-WIDE, NOT YOUR PLAYERS, AND THE CARD SAYS SO. It is
 * the newest scoring plays in the NFL, unfiltered by roster — six strangers'
 * touchdowns under a header carrying your record would read as your players
 * doing this. Naming it costs one line and is the difference between a scores
 * ticker and an implied claim. (Marking which rows ARE yours needs a join
 * from the provider's player id into the Sleeper id space the rosters use;
 * that identity cross is real work, not a label, so it is not faked here.)
 *
 * ⚠ NO FANTASY POINTS ON A PLAY, EVER. The same catch is worth different points
 * in each league the player is rostered in, so a single figure here would be
 * right for at most one of them. components/core-app/dash-v2/LivePlays.tsx is
 * the other renderer of this feed and carries the same rule — the two must stay
 * in agreement on what is NOT shown.
 *
 * A sibling component rather than an edit to Dashboard3A.tsx, which another
 * session owns — same as Dash3ATriage, DashDraftsBand and DashScheduleBand.
 */

/** How recent a play must be for the slate to count as in progress. */
const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000
const PLAY_CAP = 6
const NEXT_CAP = 8

export function DashGameDayBand({
  strip,
  plays,
  now,
  regularSeasonUnderway,
}: {
  strip: TodayStripData | null
  plays: PlayFeedItem[]
  now: Date
  /** False through the whole preseason — see the header's first gate. */
  regularSeasonUnderway: boolean
}) {
  if (!regularSeasonUnderway) return null

  const cutoff = now.getTime() - LIVE_WINDOW_MS
  const fresh = plays.filter((p) => {
    const t = new Date(p.detectedAt).getTime()
    return Number.isFinite(t) && t >= cutoff
  })

  const record = strip?.record.available ? strip.record.data : null
  if (fresh.length === 0 && !record && !strip?.next24.length) return null

  const visible = fresh.slice(0, PLAY_CAP)
  /*
   * What is still to come today, from the strip's own next-24 rows. This
   * section was one of the pieces deliberately not carried into the /core
   * cutover; inside a game window it is exactly the right context, so it lands
   * here rather than as a permanent fixture. It renders whatever kinds the
   * loader emits — waiver rows were removed there because the timings were our
   * own defaults rather than ingested, so today that is kickoffs.
   */
  const upcoming = (strip?.next24 ?? []).slice(0, NEXT_CAP)

  /*
   * ⚠ THE WORDS ARE SAID IN THE CLIENT (2026-10-04). This band keeps the decisions — both gates, the
   * play window against the server's `now`, the caps — and DashGameDayBandView says them in the
   * reader's language. Only the fields a row shows cross the boundary.
   */
  return (
    <DashGameDayBandView
      record={record ? { wins: record.wins, losses: record.losses, week: record.week } : null}
      plays={visible.map((p) => ({
        id: p.id,
        type: p.type,
        playerName: p.playerName,
        position: p.position,
        team: p.team,
        imageUrl: p.imageUrl,
        headline: p.headline,
        actionParts: p.actionParts,
      }))}
      upcoming={upcoming.map((row, i) => ({
        key: `${row.kind}:${row.time}:${i}`,
        time: row.time,
        tone: row.tone,
        text: row.text,
        sub: row.sub,
        parts: row.parts,
        game: row.game,
      }))}
    />
  )
}
