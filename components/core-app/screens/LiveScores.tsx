'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MiniPlayerImg from '@/components/MiniPlayerImg'
import type { LiveGameCard, LivePageData } from '@/lib/live/liveScoresPage'
import { matchesLiveGameQuery } from '@/lib/live/liveGameSearch'
import { groupStartersByPlayer, pointsSummary, type StarterGroup } from '@/lib/live/liveTieInGroups'
import type { BaseballPlayer } from '@/lib/live/espnGamePresentation'
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

/**
 * Play-feed labels and tone.
 *
 * Kept local rather than imported from `dash-v2/LivePlays`: that component
 * renders a raw `LiveEvent` under the `af-d2-*` stylesheet, which this screen
 * does not load. Sharing it would mean pulling another screen's CSS onto this
 * one for two small maps.
 */
const PLAY_TYPE_LABEL: Record<string, string> = {
  TOUCHDOWN: 'TD',
  BIG_PLAY: 'BIG PLAY',
  TURNOVER: 'TURNOVER',
  FIELD_GOAL: 'FG',
  DEFENSIVE_SCORE: 'DEF TD',
  SPECIAL_TEAMS_SCORE: 'ST TD',
}

/** A score is good, a turnover costs someone, a big gain is merely notable. */
function playTone(type: string): 'good' | 'bad' | 'warn' {
  if (type === 'TURNOVER') return 'bad'
  if (type === 'BIG_PLAY') return 'warn'
  return 'good'
}

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
  const [query, setQuery] = useState('')
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
  const visibleGames = useMemo(
    () => data.games.filter((game) => matchesLiveGameQuery(game, query)),
    [data.games, query],
  )

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
    /*
     * ⚠ NULL IS CHECKED BEFORE `new Date`, NOT AFTER. `new Date(null)` is the
     * epoch, not an invalid date, so it parses cleanly and would render an age
     * measured in decades. The loader now returns null when it cannot date the
     * feed — see `LivePageData.fetchedAt` — and this is what turns that into no
     * claim rather than an absurd one.
     */
    if (data.fetchedAt == null) return null
    const at = new Date(data.fetchedAt).getTime()
    // No age before mount, and none for an unparseable timestamp. Both render
    // without a freshness claim rather than with a wrong one.
    if (now == null || Number.isNaN(at)) return null
    return Math.max(0, Math.round((now - at) / 1000))
  }, [data.fetchedAt, now])

  const activeSportLabel =
    data.counts.find((c) => c.sport === data.sport)?.label ?? data.sport

  /*
   * Newest play per game, for the in-card panel.
   *
   * ⚠ FIRST WINS, BECAUSE THE FEED IS NEWEST-FIRST. `impact.plays` documents
   * itself as "the recent play feed for this slate, NEWEST FIRST", so the first
   * entry seen for a gameId is the latest one and later entries are older —
   * `has()` before `set()` keeps it rather than letting the oldest overwrite.
   * Reversing this silently shows a stale play beside a live score, which is
   * indistinguishable from a stuck feed.
   *
   * Memoised on `data.impact.plays` alone: it is rebuilt on every 20s poll and
   * the slate can hold a dozen cards, so re-deriving it per card per render is
   * the kind of quiet cost this screen's `contain: layout` note is about.
   */
  const latestPlayByGame = useMemo(() => {
    const byGame = new Map<string, LivePageData['impact']['plays'][number]>()
    for (const p of data.impact.plays) {
      if (!p.gameId || byGame.has(p.gameId)) continue
      byGame.set(p.gameId, p)
    }
    return byGame
  }, [data.impact.plays])

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

          <label className="af-live-search">
            <span aria-hidden>⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search team, game, or your player"
              aria-label="Search this live scoreboard by team, game, player, or league"
            />
          </label>

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
            {activeSportLabel} · {scope === 'my' ? 'your starters, sorted by leagues affected' : 'all games'}
          </h2>

          {visibleGames.length === 0 ? (
            query.trim() ? (
              <div className="af-live-empty">
                <p className="af-live-empty-title">No scoreboard match for “{query.trim()}”.</p>
                <p className="af-live-empty-body">
                  Try a team name, abbreviation, rostered player, or league name.
                </p>
              </div>
            ) : (
              <EmptySlate
                scope={scope}
                hasRosterData={data.hasRosterData}
                loadFailed={data.loadFailed}
                rosterFailed={data.rosterFailed}
              />
            )
          ) : (
            visibleGames.map((game) => (
              <GameCard
                key={game.gameId}
                game={game}
                scope={scope}
                selectedLeagueId={selectedLeagueId}
                lastPlay={latestPlayByGame.get(game.gameId) ?? null}
              />
            ))
          )}
        </section>

        <aside className="af-live-side" aria-label="Your live impact">
          <div className="af-live-impact">
            <h2 className="af-label">Your live impact</h2>
            {data.rosterFailed ? (
              /*
               * ⚠ THE SAME RULE AS THE BRANCH BELOW, FOR A DIFFERENT REASON.
               * The em dash is right — we have no number we can stand behind —
               * but "claim your team" is the wrong explanation and an actively
               * misleading instruction: the team IS claimed, the read failed.
               * "We could not read it" and "you have not created one" are
               * different facts, exactly as that branch argues about 0.0.
               */
              <>
                <p className="af-live-impact-total" data-missing="true">
                  <span className="af-num">—</span>
                  <span>we could not read your rosters</span>
                </p>
                <p className="af-live-impact-sub">
                  This is a problem on our end, not an empty roster. The scores themselves are
                  fine.
                </p>
              </>
            ) : data.hasRosterData ? (
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

          {data.impact.plays.length > 0 ? (
            <div className="af-live-card">
              {/*
                Conditional, not empty-stated, because both cards either side of
                it behave that way — an aside stacked with "nothing yet"
                placeholders is noise on a Tuesday. `impact.plays` is NFL-only by
                construction, so on any other tab this card is simply absent.
              */}
              <h2 className="af-label">Live plays</h2>
              <ul className="af-live-plays">
                {data.impact.plays.map((p) => (
                  /* Keyed on the feed's own idempotency key — the same key it
                     dedupes on, so re-polling cannot duplicate a row. */
                  <li key={p.id} className="af-live-play" data-tone={playTone(p.type)}>
                    <MiniPlayerImg
                      sleeperId={null}
                      name={p.playerName}
                      avatarUrl={p.imageUrl}
                      size={28}
                    />
                    <span className="af-live-play-text">
                      <span className="af-live-play-head">
                        <span className="af-live-play-type af-num" data-tone={playTone(p.type)}>
                          {PLAY_TYPE_LABEL[p.type] ?? p.type}
                        </span>
                        {/*
                          Logo when we resolved one, the abbreviation when we
                          only know the team, nothing when we know neither —
                          the same ladder the headshot uses. `teamLogoUrl` is
                          null unless a team was actually resolved, so this
                          never renders a badge for a guessed abbreviation.
                        */}
                        {p.teamLogoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="af-live-play-logo"
                            src={p.teamLogoUrl}
                            alt={p.team ?? ''}
                            width={14}
                            height={14}
                            loading="lazy"
                          />
                        ) : p.team ? (
                          <span className="af-live-play-team af-num">{p.team}</span>
                        ) : null}
                      </span>
                      {/*
                        `headline` already reads "Bijan Robinson (RB) ran for 17
                        yards" — it carries the name and the position, so those
                        are not repeated beside it.

                        ⚠ AND `yards` IS NOT RENDERED, ON PURPOSE. It is
                        `Math.round(delta)` of whatever stat moved, so it is a
                        yardage only for yardage stats; on a touchdown the stat
                        is a counter and the delta is 1, which would print as
                        "+1" next to a scoring play. The headline is the composed
                        sentence that already knows the difference.
                      */}
                      <span className="af-live-play-line">{p.headline}</span>
                    </span>
                  </li>
                ))}
              </ul>
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
/**
 * Exported because the public `/live` page renders this same card
 * (`components/live/MatchupCard.tsx`) inside an `.af-core` wrapper — one game
 * card for both surfaces, so the two cannot drift apart again.
 */
export function GameCard({
  game,
  scope,
  selectedLeagueId,
  lastPlay,
}: {
  game: LiveGameCard
  /** "My games" adds your starters under the game; "All games" is the game alone. */
  scope: 'my' | 'all'
  selectedLeagueId: string | null
  /*
   * The newest play from THIS game, or null. The handoff puts the last play
   * inside the card it belongs to, and that is the one structural thing it gets
   * righter than what shipped: the feed already carries `gameId`, but the plays
   * rendered only in the sidebar, so reading "T. Hill 42-yd TD" and finding
   * which of six cards it happened in was a manual name-match every time.
   *
   * ⚠ NFL-ONLY BY CONSTRUCTION, and that is the data layer's decision, not a
   * gap here. `impact.plays` is fed from the literal cache key `pbp:feed:NFL`
   * and every LiveEventType is an NFL play, so this panel is simply absent on
   * the MLB and NCAAF tabs rather than captioning real plays with wrong games.
   */
  lastPlay: LivePageData['impact']['plays'][number] | null
}) {
  const wp = game.winProbability
  const weekLabel = game.week != null ? `${game.sport} · Week ${game.week}` : game.sport
  const isFootball = game.sport === 'NFL' || game.sport === 'NCAAF'
  const situation = game.situation
  /*
   * Baseball is recognised by its DATA, not by `sport === 'MLB'` (2026-09-13):
   * runners/count from the feed, or hits reported per team (only a baseball
   * scoreboard sends those). College baseball is not a sport in the app yet; when
   * it is added, its cards get the diamond and the R-H-E box with no change here.
   */
  const isBaseball =
    game.sport === 'MLB' || situation?.baseball != null || game.home.hits != null || game.away.hits != null
  const starters = scope === 'my' ? groupStartersByPlayer(game.tieIns) : []

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
        {game.broadcast ? <span className="af-live-broadcast af-num">{game.broadcast}</span> : null}
      </div>

      <div className="af-live-teams">
        <Side
          side={game.away}
          align="start"
          leading={leads(game.away.score, game.home.score)}
          hasBall={situation?.possession === 'away'}
        />
        <span className="af-live-at af-num" aria-hidden>
          @
        </span>
        <Side
          side={game.home}
          align="end"
          leading={leads(game.home.score, game.away.score)}
          hasBall={situation?.possession === 'home'}
        />
      </div>

      <Linescore game={game} isFootball={isFootball} isBaseball={isBaseball} />

      {/*
        ── Field strip ─────────────────────────────────────────────────────────
        This card used to carry a note refusing a field diagram because "the
        data layer has no yard line". The ESPN scoreboard we already fetch has
        one (`situation.possessionText`) — the mapper was discarding it. The
        strip is drawn only when `ballOn` could be PLACED from that text; an
        unplaceable position renders the down and distance with no ball rather
        than a ball at a guessed yard line.
      */}
      {isFootball && situation ? <FieldStrip game={game} /> : null}
      {situation?.baseball ? <Diamond game={game} /> : null}

      {/*
        Last play: ESPN's own play text when the scoreboard carries it — it is
        the play of THIS game by construction. The derived NFL play feed stays
        as the fallback, e.g. on a poll served from the cache.
      */}
      {situation?.lastPlay ? (
        <div className="af-live-lastplay">
          <span className="af-label af-live-lastplay-head">
            Last play
            {situation.lastPlayType ? (
              <span className="af-live-lastplay-type af-num">{situation.lastPlayType}</span>
            ) : null}
          </span>
          <p className="af-live-lastplay-text">{situation.lastPlay}</p>
        </div>
      ) : lastPlay ? (
        <div className="af-live-lastplay" data-tone={playTone(lastPlay.type)}>
          <span className="af-label af-live-lastplay-head">
            Last play
            <span className="af-live-lastplay-type af-num" data-tone={playTone(lastPlay.type)}>
              {PLAY_TYPE_LABEL[lastPlay.type] ?? lastPlay.type}
            </span>
          </span>
          <p className="af-live-lastplay-text">{lastPlay.headline}</p>
          <span className="af-live-lastplay-who">
            <MiniPlayerImg
              sleeperId={null}
              name={lastPlay.playerName}
              avatarUrl={lastPlay.imageUrl}
              size={20}
            />
            <span className="af-live-lastplay-name">{lastPlay.playerName}</span>
            {/* Only when the identity map actually resolved it — the feed sends
                team: null on every Rolling Insights event, so a blank chip here
                would be the normal case rather than the exception. */}
            {lastPlay.team ? (
              <span className="af-live-lastplay-team af-num">{lastPlay.team}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      {/*
        Labelled "estimate" because the type makes it impossible to honestly do
        otherwise: `isEstimate` is a literal `true` on WinProbability precisely
        so this cannot be rendered as a measured number.
      */}
      <Leaders game={game} />

      {/*
        Labelled "estimate" because the type makes it impossible to honestly do
        otherwise. Omitted before kickoff rather than drawn as a "not estimated"
        row — the card is the game, and an empty placeholder is not part of it.
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
      ) : null}

      {game.venue ? (
        <p className="af-live-venue">
          <span className="af-live-venue-name">{game.venue.name}</span>
          {game.venue.location ? <span> · {game.venue.location}</span> : null}
        </p>
      ) : null}

      {starters.length > 0 ? (
        <MyStarters gameId={game.gameId} groups={starters} selectedLeagueId={selectedLeagueId} />
      ) : null}
    </article>
  )
}

/** Per-period scores with a total column — the "1 2 3 4 T" grid. */
function Linescore({
  game,
  isFootball,
  isBaseball,
}: {
  game: LiveGameCard
  isFootball: boolean
  isBaseball: boolean
}) {
  const awayLines = game.away.linescores ?? []
  const homeLines = game.home.linescores ?? []
  const played = Math.max(awayLines.length, homeLines.length)
  if (played === 0) return null
  // Football always shows four quarters and baseball nine innings, so an early
  // grid is not two columns wide. Extra innings simply add columns.
  const columns = Math.max(played, isFootball ? 4 : isBaseball ? 9 : played)
  const label = (i: number) => (isFootball && i >= 4 ? (i === 4 ? 'OT' : `OT${i - 3}`) : String(i + 1))

  return (
    <div className="af-live-linescore-wrap">
      <table className="af-live-linescore af-num">
        <thead>
          <tr>
            <th scope="col" aria-label="Team" />
            {Array.from({ length: columns }, (_, i) => (
              <th key={i} scope="col">
                {label(i)}
              </th>
            ))}
            {isBaseball ? (
              <>
                <th scope="col">R</th>
                <th scope="col">H</th>
                <th scope="col">E</th>
              </>
            ) : (
              <th scope="col">T</th>
            )}
          </tr>
        </thead>
        <tbody>
          {[
            { side: game.away, lines: awayLines },
            { side: game.home, lines: homeLines },
          ].map(({ side, lines }) => (
            <tr key={side.abbrev}>
              <th scope="row">{side.abbrev}</th>
              {Array.from({ length: columns }, (_, i) => (
                <td key={i}>{lines[i] ?? ''}</td>
              ))}
              <td className="af-live-linescore-total">{side.score ?? '—'}</td>
              {isBaseball ? (
                <>
                  <td className="af-live-linescore-he">{side.hits ?? '—'}</td>
                  <td className="af-live-linescore-he">{side.errors ?? '—'}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const YARD_MARKS = [10, 20, 30, 40, 50, 60, 70, 80, 90]

/**
 * The field: away end zone on the left, home on the right, ball at `ballOn`
 * (0–100 from the away goal line), first-down line when the distance is known.
 */
function FieldStrip({ game }: { game: LiveGameCard }) {
  const s = game.situation
  if (!s) return null
  const ball = s.ballOn
  const toward = s.possession === 'away' ? 1 : s.possession === 'home' ? -1 : 0
  const goalToGo = /goal/i.test(s.shortDownDistance ?? s.downDistance ?? '')
  const firstDown =
    ball != null && s.distance != null && toward !== 0 && !goalToGo
      ? Math.min(100, Math.max(0, ball + toward * s.distance))
      : null
  const offense = s.possession === 'away' ? game.away : s.possession === 'home' ? game.home : null

  return (
    <div className="af-live-field-block">
      <div className="af-live-field-meta">
        {s.downDistance || s.shortDownDistance ? (
          <span className="af-live-down af-num">{s.downDistance ?? s.shortDownDistance}</span>
        ) : null}
        {s.isRedZone ? <span className="af-live-redzone af-label">Red zone</span> : null}
        <span className="af-live-timeouts">
          <Timeouts abbrev={game.away.abbrev} left={s.awayTimeouts} />
          <Timeouts abbrev={game.home.abbrev} left={s.homeTimeouts} />
        </span>
      </div>

      {ball != null ? (
        <div
          className="af-live-field"
          role="img"
          aria-label={`${offense ? `${offense.abbrev} ball` : 'Ball'}${s.downDistance ? `, ${s.downDistance}` : ''}`}
        >
          <EndZone side={game.away} />
          <div className="af-live-grass" data-redzone={s.isRedZone ? (toward > 0 ? 'home' : 'away') : undefined}>
            {YARD_MARKS.map((y) => (
              <span key={y} className="af-live-yard" style={{ left: `${y}%` }}>
                <span className="af-live-yard-num af-num">{y <= 50 ? y : 100 - y}</span>
              </span>
            ))}
            {firstDown != null ? <span className="af-live-firstdown" style={{ left: `${firstDown}%` }} /> : null}
            <span
              className="af-live-ball"
              data-dir={toward > 0 ? 'right' : toward < 0 ? 'left' : 'none'}
              style={{ left: `${ball}%` }}
            />
          </div>
          <EndZone side={game.home} />
        </div>
      ) : null}
    </div>
  )
}

/** Base centres on a 100×100 diamond: first on the right, second at the top, third on the left.
 *  Listed in base order so the spoken label reads "first and second". */
const BASES = [
  { key: 'first', cx: 86, cy: 50 },
  { key: 'second', cx: 50, cy: 14 },
  { key: 'third', cx: 14, cy: 50 },
] as const

/**
 * Baseball: runners on the diamond, balls/strikes/outs, and who is pitching to
 * whom. Everything is ESPN's `situation`; a count ESPN did not send is left
 * unlit rather than drawn as 0-0.
 */
function Diamond({ game }: { game: LiveGameCard }) {
  const b = game.situation?.baseball
  if (!b) return null
  const on = { first: b.onFirst, second: b.onSecond, third: b.onThird }
  const runners = BASES.filter((base) => on[base.key]).map((base) => base.key)
  const basesLabel = runners.length === 0 ? 'Bases empty' : `Runner${runners.length > 1 ? 's' : ''} on ${runners.join(' and ')}`
  const countLabel =
    b.balls != null && b.strikes != null && b.outs != null
      ? `, ${b.balls}-${b.strikes} count, ${b.outs} ${b.outs === 1 ? 'out' : 'outs'}`
      : ''

  return (
    <div className="af-live-diamond-block">
      <svg className="af-live-diamond" viewBox="0 0 100 100" role="img" aria-label={`${basesLabel}${countLabel}`}>
        <path className="af-live-diamond-path" d="M50 86 L86 50 L50 14 L14 50 Z" />
        {BASES.map((base) => (
          <rect
            key={base.key}
            className="af-live-base"
            data-base={base.key}
            data-on={on[base.key]}
            x={base.cx - 8}
            y={base.cy - 8}
            width={16}
            height={16}
            transform={`rotate(45 ${base.cx} ${base.cy})`}
          />
        ))}
        <rect className="af-live-plate" x={44} y={80} width={12} height={12} transform="rotate(45 50 86)" />
      </svg>

      <div className="af-live-count" aria-hidden>
        <CountRow label="B" n={b.balls} max={3} tone="good" />
        <CountRow label="S" n={b.strikes} max={2} tone="bad" />
        <CountRow label="O" n={b.outs} max={2} tone="warn" />
      </div>

      {b.pitcher || b.batter ? (
        <ul className="af-live-atbat">
          {b.pitcher ? <AtBatRow role="Pitching" player={b.pitcher} /> : null}
          {b.batter ? <AtBatRow role="At bat" player={b.batter} /> : null}
        </ul>
      ) : null}
    </div>
  )
}

function CountRow({ label, n, max, tone }: { label: string; n: number | null; max: number; tone: 'good' | 'bad' | 'warn' }) {
  return (
    <span className="af-live-count-row" data-count={label}>
      <span className="af-label">{label}</span>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className="af-live-count-dot" data-tone={tone} data-on={n != null && i < n} />
      ))}
    </span>
  )
}

function AtBatRow({ role, player }: { role: string; player: BaseballPlayer }) {
  return (
    <li className="af-live-atbat-row">
      <MiniPlayerImg sleeperId={null} name={player.name} avatarUrl={player.headshot} size={30} />
      <span className="af-live-atbat-text">
        <span className="af-label">{role}</span>
        <span className="af-live-atbat-name">
          {player.name}
          {player.position ? <span className="af-live-leader-meta"> {player.position}</span> : null}
        </span>
        {player.summary ? <span className="af-live-atbat-line af-num">{player.summary}</span> : null}
      </span>
    </li>
  )
}

function EndZone({ side }: { side: LiveGameCard['home'] }) {
  return (
    <span className="af-live-endzone">
      {side.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={side.logo} alt="" width={20} height={20} loading="lazy" />
      ) : (
        <span className="af-num">{side.abbrev}</span>
      )}
    </span>
  )
}

function Timeouts({ abbrev, left }: { abbrev: string; left: number | null }) {
  if (left == null) return null
  return (
    <span className="af-live-to" aria-label={`${abbrev} ${left} timeouts left`}>
      <span className="af-num">{abbrev}</span>
      {[0, 1, 2].map((i) => (
        <span key={i} className="af-live-to-dot" data-used={i >= left} aria-hidden />
      ))}
    </span>
  )
}

/**
 * PASS / RUSH / REC with headshots, the way ESPN's game strip lays them out.
 * Falls back to the single top performer when only that is known, and to
 * nothing at all before kickoff.
 */
function Leaders({ game }: { game: LiveGameCard }) {
  const leaders = game.leaders ?? []
  if (leaders.length > 0) {
    return (
      <ul className="af-live-leaders" aria-label="Game leaders">
        {leaders.map((l) => (
          <li key={`${l.label ?? ''}-${l.name}`} className="af-live-leader">
            <span className="af-label af-live-leader-cat">{l.label ?? ''}</span>
            <MiniPlayerImg
              sleeperId={null}
              name={l.name}
              avatarUrl={l.headshot}
              size={34}
              className="af-live-leader-face"
            />
            <span className="af-live-leader-text">
              <span className="af-live-leader-name">
                {l.name}
                {l.position || l.teamAbbrev ? (
                  <span className="af-live-leader-meta">
                    {' '}
                    {[l.position, l.teamAbbrev].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
              <span className="af-live-leader-line af-num">{l.statLine}</span>
            </span>
          </li>
        ))}
      </ul>
    )
  }
  if (game.topPerformer) {
    return (
      <div className="af-live-top">
        <span className="af-label">Top performer</span>
        <span className="af-live-top-name">{game.topPerformer.name}</span>
        <span className="af-live-top-line af-num">{game.topPerformer.statLine}</span>
      </div>
    )
  }
  return null
}

/**
 * "My games": your STARTERS in this game, one row per player, and the leagues
 * he starts in behind a disclosure. Bench, IR and taxi are not listed — user
 * decision 2026-09-13; the old list printed one row per league with bench
 * included, which is how one game card reached forty-six rows.
 */
function MyStarters({
  gameId,
  groups,
  selectedLeagueId,
}: {
  gameId: string
  groups: StarterGroup[]
  selectedLeagueId: string | null
}) {
  const leagueCount = new Set(groups.flatMap((g) => g.leagues.map((l) => l.leagueId))).size
  return (
    <div className="af-live-tieins">
      <p className="af-label af-live-tieins-head">
        Your starters · {groups.length} {groups.length === 1 ? 'player' : 'players'} · {leagueCount}{' '}
        {leagueCount === 1 ? 'league' : 'leagues'}
      </p>
      <ul className="af-live-mine">
        {groups.map((g) => (
          <StarterRow key={g.playerId} gameId={gameId} group={g} selectedLeagueId={selectedLeagueId} />
        ))}
      </ul>
    </div>
  )
}

function StarterRow({
  gameId,
  group,
  selectedLeagueId,
}: {
  gameId: string
  group: StarterGroup
  selectedLeagueId: string | null
}) {
  const [open, setOpen] = useState(false)
  const summary = pointsSummary(group)
  const panelId = `af-live-mine-${gameId}-${group.playerId}`
  const holdsSelected = selectedLeagueId != null && group.leagues.some((l) => l.leagueId === selectedLeagueId)
  const n = group.leagues.length

  return (
    <li className="af-live-mine-row" data-open={open} data-selected={holdsSelected}>
      <button
        type="button"
        className="af-live-mine-toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <MiniPlayerImg sleeperId={group.playerId} name={group.playerName} avatarUrl={group.imageUrl} size={30} />
        <span className="af-live-mine-name">
          {group.playerName}
          {group.position ? <span className="af-live-mine-pos"> {group.position}</span> : null}
        </span>
        <span className="af-live-mine-count">
          {n} {n === 1 ? 'league' : 'leagues'}
        </span>
        {/*
          A range across leagues, never one league's number — each league scores
          the same play its own way. An em dash when nobody has reported.
        */}
        <span className="af-live-mine-pts af-num">
          {summary == null
            ? '—'
            : summary.min === summary.max
              ? `${summary.max.toFixed(1)} pts`
              : `${summary.min.toFixed(1)}–${summary.max.toFixed(1)} pts`}
        </span>
        <span className="af-live-mine-chev" aria-hidden />
      </button>
      {open ? (
        <ul id={panelId} className="af-live-mine-leagues">
          {group.leagues.map((l) => (
            <li key={l.leagueId} data-selected={l.leagueId === selectedLeagueId}>
              <span className="af-live-mine-league">{l.leagueName}</span>
              <span className="af-live-mine-league-pts af-num">
                {l.points == null ? '—' : `${l.points.toFixed(1)} pts`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Side({
  side,
  align,
  leading,
  hasBall,
}: {
  side: LiveGameCard['home']
  align: 'start' | 'end'
  leading: boolean
  hasBall: boolean
}) {
  return (
    <div className="af-live-side-team" data-align={align}>
      {/*
        The crest when we resolved one, the abbreviation when we did not. The
        logo already travelled on the card and this component simply never read
        it, so college slates rendered as text marks while the URL sat unused.
        Falling back to the abbreviation keeps the row readable rather than
        leaving a hole where an image failed.
      */}
      {side.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="af-live-team-crest" src={side.logo} alt="" width={38} height={38} loading="lazy" />
      ) : (
        <span className="af-live-team-mark af-num" aria-hidden>
          {side.abbrev}
        </span>
      )}
      <span className="af-live-team-text">
        <span className="af-live-team-name">
          {side.name}
          {hasBall ? (
            <span className="af-live-possession" role="img" aria-label="has the ball" title="Possession" />
          ) : null}
        </span>
        {/* Records are not published for every league/sport; withheld, not "0—0". */}
        <span className="af-live-team-record af-num">{side.record ?? '—'}</span>
      </span>
      {/* Withheld before kickoff, exactly like the record above — a scheduled
          game showed "0 @ 0", which is a result nobody played. */}
      <span className="af-live-team-score af-num" data-leading={leading}>
        {side.score ?? '—'}
      </span>
    </div>
  )
}

function leads(a: number | null, b: number | null): boolean {
  // Nobody leads a game that has not started.
  if (a === null || b === null) return false
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
  rosterFailed,
}: {
  scope: 'my' | 'all'
  hasRosterData: boolean
  loadFailed: boolean
  rosterFailed: boolean
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

  /*
   * The fourth distinct state this panel needs, by the same rule as the three
   * above: a failed ROSTER read is not a failed slate and not a quiet Sunday.
   * Without it, `scope: 'my'` falls through to "None of your players are playing
   * right now" over "Claim your team in one of your leagues" — both false, told
   * to someone who has already claimed a team and whose players may be on the
   * field. Below loadFailed because a dead slate is the larger fault; above the
   * normal state because that state asserts something we do not know.
   */
  if (rosterFailed) {
    return (
      <div className="af-live-empty" data-tone="bad">
        <p className="af-live-empty-title">We could not read your rosters.</p>
        <p className="af-live-empty-body">
          The scores themselves are fine — this is a problem on our end, so we cannot say which
          games involve your players. Switch to All games to see the full slate meanwhile.
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
