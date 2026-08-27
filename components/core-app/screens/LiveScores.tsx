'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MiniPlayerImg from '@/components/MiniPlayerImg'
import type { LiveGameCard, LivePageData, LiveRosterTieIn } from '@/lib/live/liveScoresPage'
import '@/components/core-app/af-live.css'

/**
 * Screen 38a·2 — Live Scores, inside the AF Core shell.
 *
 * ⚠ THIS IS A SECOND SKIN ON ONE DATA LAYER, NOT A SECOND LIVE PAGE. Everything
 * here comes from `getLivePageData` and refreshes from the same
 * `/api/dashboard/live-scores?view=live` endpoint the public `/live` page polls.
 * That page stays as it is — it renders signed-out, because scores are public
 * information and it is the surface that gets indexed. This one is the
 * signed-in, in-shell view with the league you are holding marked in it.
 *
 * Three rules the data layer imposes on this screen, not the other way round:
 *
 *   1. Win probability is `{ home, away, isEstimate: true }` and `isEstimate` is
 *      a literal `true` in the type specifically "so a consumer can never render
 *      this unlabelled by accident". So it renders labelled. Always.
 *   2. "Could not load" and "nothing is on" are different claims. On a live
 *      scoring page, an outage drawn as an empty slate tells someone their
 *      players are not playing, which is the worst lie this screen could tell.
 *   3. The freshness clock is client-only and ticks. The server cannot know how
 *      stale a payload will be by the time the browser paints it, and seeding
 *      the age on the server fails hydration outright.
 */

/** 20s while something is in progress, 2 minutes otherwise — the same cadence
 *  the server-side engine uses. Polling every 20s on a Tuesday burns requests
 *  re-fetching a slate that cannot change. */
const LIVE_POLL_MS = 20_000
const IDLE_POLL_MS = 120_000

export type LiveScoresProps = {
  data: LivePageData
  /** The league held in the rail, so its tie-ins can be marked. Null on the
   *  cross-league entry, which is the normal case for this screen. */
  selectedLeagueId?: string | null
}

export function LiveScores({ data: initial, selectedLeagueId = null }: LiveScoresProps) {
  const [data, setData] = useState<LivePageData>(initial)
  const [scope, setScope] = useState<'my' | 'all'>(initial.scope)
  const [sport, setSport] = useState(initial.sport)
  const [now, setNow] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Guards against a slow response for an old sport landing after a new one.
  const seqRef = useRef(0)

  const load = useCallback(async (nextSport: string, nextScope: 'my' | 'all') => {
    const seq = ++seqRef.current
    setRefreshing(true)
    try {
      const res = await fetch(
        `/api/dashboard/live-scores?view=live&sport=${encodeURIComponent(nextSport)}&scope=${nextScope}`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const json = (await res.json()) as LivePageData
      // A stale response must never overwrite a newer one.
      if (seq !== seqRef.current) return
      setData(json)
      setNow(Date.now())
    } catch {
      /*
       * A failed poll leaves the last good data on screen and the age label
       * keeps climbing. That is the honest signal — the numbers are getting
       * older and you can see it — where a silent retry would let them rot
       * behind a "just now".
       */
    } finally {
      if (seq === seqRef.current) setRefreshing(false)
    }
  }, [])

  const anyLive = data.games.some((g) => g.isLive)

  useEffect(() => {
    const id = window.setInterval(() => void load(sport, scope), anyLive ? LIVE_POLL_MS : IDLE_POLL_MS)
    return () => window.clearInterval(id)
  }, [load, sport, scope, anyLive])

  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const pickSport = (next: string) => {
    setSport(next)
    void load(next, scope)
  }
  const pickScope = (next: 'my' | 'all') => {
    setScope(next)
    void load(sport, next)
  }

  const ageSeconds = useMemo(() => {
    const at = new Date(data.fetchedAt).getTime()
    // No age before mount, and none for an unparseable timestamp. Both render
    // without a freshness claim rather than with a wrong one.
    if (now == null || Number.isNaN(at)) return null
    return Math.max(0, Math.round((now - at) / 1000))
  }, [data.fetchedAt, now])

  const activeSportLabel =
    data.counts.find((c) => c.sport === data.sport)?.label ?? data.sport

  return (
    <div className="af-live">
      <header className="af-live-head">
        <p className="af-label af-live-eyebrow">Core · Live</p>
        <h1 className="af-display af-live-title">Live Scores</h1>
        <p className="af-live-lede">
          Every live matchup across your {data.counts.length} sports, scored against your rosters in
          real time.
        </p>
      </header>

      {/* ── Control bar ─────────────────────────────────────────────── */}
      <div className="af-live-bar">
        <div className="af-live-bar-top">
          <span className="af-live-bar-name">Live Scores</span>

          <div className="af-live-scope" role="group" aria-label="Which games to show">
            <button
              type="button"
              className="af-live-scope-btn"
              data-active={scope === 'my'}
              aria-pressed={scope === 'my'}
              onClick={() => pickScope('my')}
            >
              My games
            </button>
            <button
              type="button"
              className="af-live-scope-btn"
              data-active={scope === 'all'}
              aria-pressed={scope === 'all'}
              onClick={() => pickScope('all')}
            >
              All games
            </button>
          </div>

          <span className="af-live-freshness" data-live={anyLive} aria-live="polite">
            {anyLive ? <span className="af-live-pulse" aria-hidden /> : null}
            {anyLive ? 'Live' : 'Idle'}
            {ageSeconds != null ? <span> · updated {formatAge(ageSeconds)} ago</span> : null}
            {refreshing ? <span className="af-live-refreshing" aria-hidden> ·</span> : null}
          </span>
        </div>

        {/*
          Every sport is listed, including the ones at zero. A sport that
          disappears when nothing is on reads as "we stopped covering that",
          and the count is the answer to "is anything on?" — hiding it removes
          the answer.
        */}
        {/*
          ⚠ A TABLIST WHOSE TABS CONTROL NOTHING IS A LIE TO A SCREEN READER.
          These shipped as role="tab" with no aria-controls and no tabpanel,
          which announces "tab 3 of 7" and then gives the user nothing to move
          into. They genuinely do swap the slate below, so the slate is the
          panel and the wiring says so.
        */}
        <div className="af-live-sports" role="tablist" aria-label="Sport">
          {data.counts.map((c) => (
            <button
              key={c.sport}
              type="button"
              role="tab"
              id={`af-live-tab-${c.sport}`}
              className="af-live-sport"
              data-active={c.sport === sport}
              data-quiet={c.slateCount === 0}
              aria-selected={c.sport === sport}
              aria-controls="af-live-slate"
              /* Only the selected tab is in the tab order; arrow keys are the
                 expected way through a tablist, and seven tab stops for a
                 filter is worse than one. */
              tabIndex={c.sport === sport ? 0 : -1}
              onClick={() => pickSport(c.sport)}
            >
              {c.label}
              {/* Today's slate for this sport, not games in progress — a live
                  count reads 0 for most of the day and made the badge look broken. */}
              <span
                className="af-live-sport-count af-num"
                aria-label={`${c.slateCount} ${c.slateCount === 1 ? 'game' : 'games'} today`}
              >
                {c.slateCount}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Slate + impact ──────────────────────────────────────────── */}
      <div className="af-live-grid">
        <section
          className="af-live-slate"
          id="af-live-slate"
          role="tabpanel"
          aria-labelledby={`af-live-tab-${data.sport}`}
          /* Focusable so a keyboard user can actually land in the panel their
             tab points at; -1 keeps it out of the sequential tab order. */
          tabIndex={-1}
        >
          <h2 className="af-label af-live-slate-head">
            {activeSportLabel} · sorted by leagues affected
          </h2>

          {data.games.length === 0 ? (
            <EmptySlate scope={scope} hasRosterData={data.hasRosterData} loadFailed={data.loadFailed} />
          ) : (
            data.games.map((game) => (
              <GameCard key={game.gameId} game={game} selectedLeagueId={selectedLeagueId} />
            ))
          )}
        </section>

        <aside className="af-live-side" aria-label="Your live impact">
          <div className="af-live-impact">
            <h2 className="af-label">Your live impact</h2>
            {data.hasRosterData ? (
              <>
                <p className="af-live-impact-total">
                  <span className="af-num">{data.impact.totalPoints.toFixed(1)}</span>
                  <span>fantasy pts scored live right now</span>
                </p>
                <p className="af-live-impact-sub">
                  {data.impact.livePlayers === 0
                    ? 'None of your players are on the field at the moment.'
                    : `${data.impact.livePlayers} of your players ${
                        data.impact.livePlayers === 1 ? 'is' : 'are'
                      } live across ${data.impact.liveGames} ${
                        data.impact.liveGames === 1 ? 'game' : 'games'
                      }.`}
                </p>
              </>
            ) : (
              /*
               * ⚠ NOT "0.0 PTS". Nobody has claimed a team, so there is no
               * roster to score — which is a different fact from scoring
               * nothing, and the em dash is the house rule for exactly this.
               */
              <>
                <p className="af-live-impact-total" data-missing="true">
                  <span className="af-num">—</span>
                  <span>no roster to score against yet</span>
                </p>
                <p className="af-live-impact-sub">
                  Claim your team in one of your leagues and this fills in automatically.
                </p>
              </>
            )}
          </div>

          {data.impact.biggestMover ? (
            <div className="af-live-card">
              <h2 className="af-label">Biggest mover</h2>
              <div className="af-live-mover">
                <MiniPlayerImg
                  sleeperId={null}
                  name={data.impact.biggestMover.playerName}
                  avatarUrl={data.impact.biggestMover.imageUrl}
                  size={34}
                />
                <div className="af-live-mover-text">
                  <span className="af-live-mover-name">{data.impact.biggestMover.playerName}</span>
                  <span className="af-live-mover-line">{data.impact.biggestMover.headline}</span>
                  {data.impact.biggestMover.leagues.length > 0 ? (
                    <span className="af-live-mover-leagues">
                      {data.impact.biggestMover.leagues.join(' · ')}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {data.impact.upNext.length > 0 ? (
            <div className="af-live-card">
              <h2 className="af-label">Up next for you</h2>
              <ul className="af-live-next">
                {data.impact.upNext.map((u, i) => (
                  <li key={`${u.playerName}-${i}`}>
                    <span className="af-live-next-label">
                      {u.playerName} · {u.matchup}
                    </span>
                    <span className="af-live-next-time af-num">{u.startTime}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="af-live-note">
            Scores come from the official feed. AllFantasy only reads your leagues — nothing here
            changes anything on your platform.
          </p>
        </aside>
      </div>
    </div>
  )
}

/**
 * One game.
 *
 * ⚠ THE CARD'S STRUCTURE IS FIXED EVEN WHEN ITS DATA IS NOT. Scores, clock and
 * win probability all change under a poll; if a missing top performer collapsed
 * its row, arriving data would shove every card below it down the page while
 * someone was reading. Optional blocks reserve their space, and scores are
 * tabular so a 7→14 does not re-centre the row.
 */
function GameCard({
  game,
  selectedLeagueId,
}: {
  game: LiveGameCard
  selectedLeagueId: string | null
}) {
  const wp = game.winProbability
  const weekLabel = game.week != null ? `${game.sport} · Week ${game.week}` : game.sport

  return (
    <article className="af-live-game" data-live={game.isLive}>
      <div className="af-live-game-head">
        <span className="af-live-tag af-label">{weekLabel}</span>
        {game.isLive ? (
          <span className="af-live-clock">
            <span className="af-live-pulse" aria-hidden />
            <span className="af-num">{game.clockLabel ?? game.statusDetail}</span>
          </span>
        ) : (
          <span className="af-live-clock" data-idle="true">
            <span className="af-num">{game.statusDetail}</span>
          </span>
        )}
      </div>

      <div className="af-live-teams">
        <Side side={game.away} align="start" leading={leads(game.away.score, game.home.score)} />
        <span className="af-live-at af-num" aria-hidden>
          @
        </span>
        <Side side={game.home} align="end" leading={leads(game.home.score, game.away.score)} />
      </div>

      {/*
        Labelled "estimate" because the type makes it impossible to honestly do
        otherwise: `isEstimate` is a literal `true` on WinProbability precisely
        so this cannot be rendered as a measured number.
      */}
      {wp ? (
        <div className="af-live-wp">
          <span className="af-label">Win prob · est</span>
          <span className="af-live-wp-bar" aria-hidden>
            <span className="af-live-wp-away" style={{ width: `${wp.away}%` }} />
            <span className="af-live-wp-home" style={{ width: `${wp.home}%` }} />
          </span>
          <span className="af-live-wp-label af-num">
            {game.away.abbrev} {wp.away}% · {game.home.abbrev} {wp.home}%
          </span>
        </div>
      ) : (
        <div className="af-live-wp" data-missing="true">
          <span className="af-label">Win prob</span>
          <span className="af-live-wp-why">not estimated before kickoff</span>
        </div>
      )}

      <div className="af-live-top" data-empty={game.topPerformer == null}>
        <span className="af-label">Top performer</span>
        {game.topPerformer ? (
          <>
            <span className="af-live-top-name">{game.topPerformer.name}</span>
            <span className="af-live-top-line af-num">{game.topPerformer.statLine}</span>
          </>
        ) : (
          <span className="af-live-top-why">no leader published for this game yet</span>
        )}
      </div>

      {game.tieIns.length > 0 ? (
        <div className="af-live-tieins">
          <p className="af-label af-live-tieins-head">
            {game.leaguesAffected === 1
              ? 'Rostered in 1 of your leagues'
              : `Rostered in ${game.leaguesAffected} of your leagues`}
          </p>
          <ul>
            {game.tieIns.map((t) => (
              <TieIn key={`${t.leagueId}-${t.playerId}`} tie={t} isSelected={t.leagueId === selectedLeagueId} />
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  )
}

function TieIn({ tie, isSelected }: { tie: LiveRosterTieIn; isSelected: boolean }) {
  return (
    <li className="af-live-tiein" data-starter={tie.isStarter} data-selected={isSelected}>
      <span className="af-live-tiein-tag af-label">
        {tie.leagueName} · {tie.isStarter ? 'Starting' : 'Bench'}
      </span>
      <span className="af-live-tiein-name">
        {tie.playerName}
        {tie.position ? <span className="af-live-tiein-pos"> {tie.position}</span> : null}
      </span>
      {/*
        A bench player scoring is not the same fact as a starter scoring, so the
        points are toned down rather than shown in the same green. Null points —
        the player is rostered but has not been scored yet — is an em dash, not
        a zero.
      */}
      <span className="af-live-tiein-pts af-num">
        {tie.points != null ? `${tie.points.toFixed(1)} pts` : '—'}
      </span>
    </li>
  )
}

function Side({
  side,
  align,
  leading,
}: {
  side: LiveGameCard['home']
  align: 'start' | 'end'
  leading: boolean
}) {
  return (
    <div className="af-live-side-team" data-align={align}>
      <span className="af-live-team-mark af-num" aria-hidden>
        {side.abbrev}
      </span>
      <span className="af-live-team-text">
        <span className="af-live-team-name">{side.name}</span>
        {/* Records are not published for every league/sport; withheld, not "0—0". */}
        <span className="af-live-team-record af-num">{side.record ?? '—'}</span>
      </span>
      <span className="af-live-team-score af-num" data-leading={leading}>
        {side.score}
      </span>
    </div>
  )
}

function leads(a: number, b: number): boolean {
  return a > b
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

/**
 * ⚠ THREE DIFFERENT REASONS FOR AN EMPTY SLATE, AND THEY ARE NOT
 * INTERCHANGEABLE. "We failed to load", "your players aren't on" and "nothing
 * is scheduled" each lead somewhere different, and collapsing them into one
 * blank panel is how a read failure gets read as a quiet Sunday.
 */
function EmptySlate({
  scope,
  hasRosterData,
  loadFailed,
}: {
  scope: 'my' | 'all'
  hasRosterData: boolean
  loadFailed: boolean
}) {
  if (loadFailed) {
    return (
      <div className="af-live-empty" data-tone="bad">
        <p className="af-live-empty-title">Scores could not be loaded.</p>
        <p className="af-live-empty-body">
          This is a problem on our end, not an empty slate — there may well be games on. Retrying
          automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="af-live-empty">
      <p className="af-live-empty-title">
        {scope === 'my' ? 'None of your players are playing right now.' : 'No games on this slate.'}
      </p>
      <p className="af-live-empty-body">
        {scope === 'my' && !hasRosterData
          ? 'Claim your team in one of your leagues and this fills in automatically.'
          : scope === 'my'
            ? 'Switch to All games to see the rest of the slate.'
            : 'Nothing is scheduled in this window.'}
      </p>
    </div>
  )
}

export default LiveScores
