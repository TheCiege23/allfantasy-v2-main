'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LiveLockAlert, LivePageData } from '@/lib/live/liveScoresPage'
import {
  connectionDetail,
  connectionLabel,
  isConnectionFault,
  resolveConnectionState,
  type LiveConnectionState,
} from '@/lib/live/connectionState'
import { useOnlineStatus } from '@/lib/live/useOnlineStatus'
import { LOW_DATA_POLL_MULTIPLIER } from '@/lib/live/lowDataMode'
import { LowDataToggle, useLowDataController } from './LowDataProvider'
import { activeFlashes, diffScores, mergeFlashes } from '@/lib/live/scoreChanges'
import { applyStableOrder, orderOf } from '@/lib/live/stableOrder'
import { ScopeToggle } from './ScopeToggle'
import { SportTabs } from './SportTabs'
import { MatchupCard } from './MatchupCard'
import { LiveImpactPanel } from './LiveImpactPanel'

/**
 * Client shell for `/live`: owns scope, sport, polling and the freshness clock.
 *
 * ⚠ THE "UPDATED Ns AGO" COUNTER IS REAL AND TICKS. Build rule 5 makes real-time
 * accuracy this page's entire premise, so the label is derived from the payload's
 * own `fetchedAt` and re-rendered on a one-second interval. A static "updated
 * just now" would be the single most misleading thing this screen could say.
 *
 * ⚠ POLL CADENCE FOLLOWS WHETHER ANYTHING IS ACTUALLY LIVE. 20s while a game is
 * in progress, 2 minutes otherwise — the same shape as the server-side cadence
 * engine. Polling every 20s all Tuesday would burn requests to re-fetch a slate
 * that cannot change.
 */

const LIVE_POLL_MS = 20_000
const IDLE_POLL_MS = 120_000

export function LiveScoresClient({ initial }: { initial: LivePageData }) {
  const [data, setData] = useState<LivePageData>(initial)
  const [scope, setScope] = useState<'my' | 'all'>(initial.scope)
  const [sport, setSport] = useState(initial.sport)
  /*
   * ⚠ NULL UNTIL MOUNTED, AND THAT IS A HYDRATION FIX AND AN HONESTY ONE.
   * Seeding this with `Date.now()` runs it on the server AND again in the
   * browser, which produced different values and failed hydration outright
   * ("Server: 0s, Client: 2s"). It is also the more truthful shape: the server
   * cannot know how stale the payload will be by the time the browser paints it,
   * so the age is a client-only fact and renders only once there is a client.
   */
  const [now, setNow] = useState<number | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  /*
   * ⚠ A FAILED POLL USED TO BE SWALLOWED ENTIRELY. The catch below still leaves
   * the last good data on screen -- that part was right -- but it said nothing, so
   * a browser that had lost the network kept displaying "Live" over numbers that
   * had stopped moving. This is what lets the badge say so.
   */
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)
  const online = useOnlineStatus()
  const { decision: lowData, setOverride: setLowData } = useLowDataController()
  // Guards against a slow response for an old sport landing after a new one.
  const requestSeq = useRef(0)
  /*
   * The validator for the payload on screen, so an unchanged slate comes back as a
   * bodiless 304 instead of the whole scoreboard again.
   *
   * ⚠ A REF, NOT STATE. In state it would change `load`'s identity on every
   * poll and restart the polling effect that depends on it -- a self-retriggering
   * refresh loop, to cache a value no render reads.
   */
  const etagRef = useRef<string | null>(null)
  /* The previous payload's scores, held only to be compared against. */
  const prevScoresRef = useRef<
    { gameId: string; home: { score: number | null }; away: { score: number | null } }[] | null
  >(null)
  const [flashes, setFlashes] = useState<Map<string, number>>(() => new Map())
  /* The order the reader is currently looking at; dropped when the view changes. */
  const orderRef = useRef<string[] | null>(null)

  const load = useCallback(
    async (nextSport: string, nextScope: 'my' | 'all') => {
      const seq = ++requestSeq.current
      setIsRefreshing(true)
      try {
        const res = await fetch(
          `/api/dashboard/live-scores?view=live&sport=${encodeURIComponent(nextSport)}&scope=${nextScope}`,
          {
            cache: 'no-store',
            headers: etagRef.current ? { 'If-None-Match': etagRef.current } : undefined,
          },
        )
        /*
         * ⚠ NOTHING CHANGED, SO NOTHING IS TOUCHED -- INCLUDING THE AGE LABEL.
         * A 304 means the payload is identical down to its `fetchedAt`, so the feed
         * was not re-read and "updated Ns ago" SHOULD keep climbing. `setNow` here
         * would reset that clock and claim a freshness we were not given.
         *
         * Checked before `res.ok`, which is false for 304 -- without this branch a
         * 304 falls into the failure path, indistinguishable from an outage.
         */
        if (res.status === 304) {
          // ⚠ A 304 IS A LANDING, NOT A MISS. The server answered; it simply had
          // nothing new. Counting it as a failure would put the badge into
          // "Reconnecting" on the quietest, healthiest slate of the week.
          setConsecutiveFailures(0)
          return
        }
        if (!res.ok) {
          setConsecutiveFailures((n) => n + 1)
          return
        }
        const json = (await res.json()) as LivePageData
        // A stale response must never overwrite a newer one.
        if (seq !== requestSeq.current) return
        /*
         * ⚠ RECORDED ONLY ONCE THE DATA IS APPLIED, AND AFTER THE STALENESS
         * GUARD FOR THAT REASON. Stamping it earlier lets a slow response for an
         * older view record a tag for a payload that never reached the screen --
         * after which the server answers 304 about data the reader has never seen
         * and the slate freezes with nothing to show why.
         */
        const tag = res.headers.get('ETag')
        etagRef.current = tag
        /*
         * ⚠ DIFFED BEFORE `setData`, AGAINST WHAT IS STILL ON SCREEN. Once
         * React has re-rendered the old scores are gone and there is nothing left
         * to compare against.
         */
        const at = Date.now()
        const changes = diffScores(prevScoresRef.current, json.games)
        prevScoresRef.current = json.games.map((g) => ({
          gameId: g.gameId,
          home: { score: g.home.score },
          away: { score: g.away.score },
        }))
        if (changes.length > 0) setFlashes((current) => mergeFlashes(current, changes, at))
        setData(json)
        setNow(at)
        setConsecutiveFailures(0)
      } catch {
        setConsecutiveFailures((n) => n + 1)
        // A failed poll leaves the last good data on screen. The freshness label
        // keeps counting up, which is exactly the honest signal: the numbers are
        // getting older and the user can see it.
      } finally {
        if (seq === requestSeq.current) setIsRefreshing(false)
      }
    },
    [],
  )

  /*
   * ⚠ THE SLATE HOLDS ITS ORDER WHILE YOU READ IT. The server breaks ties on
   * closeness, closeness comes from win probability, and win probability reads the
   * game CLOCK -- so two evenly matched games swap places every poll while nobody
   * scores. The effects below drop the remembered order when the VIEW changes.
   */
  const orderedGames = useMemo(
    () => applyStableOrder(orderRef.current, data.games, (g) => g.gameId),
    [data.games],
  )
  useEffect(() => {
    // In an effect, not during render: writing the ref while rendering makes the
    // memo read what it just produced and pins the first render's order forever.
    orderRef.current = orderOf(orderedGames, (g) => g.gameId)
  }, [orderedGames])
  useEffect(() => {
    orderRef.current = null
  }, [sport, scope])

  const litGames = useMemo(
    () => (now == null ? new Set<string>() : activeFlashes(flashes, now)),
    [flashes, now],
  )

  const anyLive = orderedGames.some((g) => g.isLive)
  /*
   * ⚠ THE CADENCE IS THE SAVING THAT COMPOUNDS. An image is paid once; the
   * poll is paid every 20 seconds for as long as the tab is open. The staleness
   * bar in `resolveConnectionState` reads this same number, so a slower cadence
   * widens it rather than reporting the feed as delayed for obeying us.
   */
  const pollIntervalMs =
    (anyLive ? LIVE_POLL_MS : IDLE_POLL_MS) * (lowData.lowData ? LOW_DATA_POLL_MULTIPLIER : 1)
  /*
   * ⚠ RESOLVED ONCE, HERE, SO THE BADGE AND THE NOTICE CANNOT DISAGREE. Two
   * components each deriving "are we connected" from the same raw inputs is two
   * chances to drift, and the failure would be a badge saying Reconnecting above
   * a page with no notice, or the reverse.
   */
  const connection = resolveConnectionState({
    online,
    consecutiveFailures,
    anyLive,
    ageSeconds:
      data.fetchedAt == null || now == null
        ? null
        : Math.max(0, Math.round((now - new Date(data.fetchedAt).getTime()) / 1000)),
    pollIntervalMs,
  })

  /*
   * Newest play per game, for the card's last-play fallback. `impact.plays` is
   * newest-first, so the first entry seen for a gameId wins — the same rule, and
   * the same reason, as `/core/live`.
   */
  const latestPlayByGame = useMemo(() => {
    const byGame = new Map<string, LivePageData['impact']['plays'][number]>()
    for (const p of data.impact.plays) {
      if (!p.gameId || byGame.has(p.gameId)) continue
      byGame.set(p.gameId, p)
    }
    return byGame
  }, [data.impact.plays])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load(sport, scope)
    }, pollIntervalMs)
    return () => window.clearInterval(interval)
    /*
     * ⚠ `pollIntervalMs` REPLACES `anyLive` HERE, AND IT HAS TO. It is derived
     * from `anyLive` so nothing is lost, but it ALSO moves when low-data mode is
     * toggled -- and depending on `anyLive` alone would leave the old interval
     * armed, so a reader who asked for fewer requests would keep making them at
     * the old rate.
     */
  }, [load, sport, scope, pollIntervalMs])

  // The freshness clock ticks independently of the poll so the label stays true
  // between refreshes — and keeps climbing when a refresh fails.
  useEffect(() => {
    setNow(Date.now())
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [])

  const onSport = (next: string) => {
    setSport(next)
    void load(next, scope)
  }
  const onScope = (next: 'my' | 'all') => {
    setScope(next)
    void load(sport, next)
  }

  return (
    <div className="live-page">
      <header
        className="sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--live-line2)' }}
      >
        <h1 className="live-display text-[20px] font-black">Live Scores</h1>
        <ScopeToggle scope={scope} onChange={onScope} />
        <div className="ml-auto flex items-center gap-2">
          <LowDataToggle
            decision={lowData}
            onChange={setLowData}
            className="live-mono rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider"
          />
          <FreshnessBadge
            fetchedAt={data.fetchedAt}
            now={now}
            anyLive={anyLive}
            isRefreshing={isRefreshing}
            online={online}
            consecutiveFailures={consecutiveFailures}
            pollIntervalMs={pollIntervalMs}
          />
        </div>
      </header>

      <div className="px-4 sm:px-6" style={{ borderBottom: '1px solid var(--live-line2)' }}>
        <SportTabs counts={data.counts} active={sport} onSelect={onSport} />
      </div>

      <div className="live-grid px-4 py-5 sm:px-6">
        <main className="flex min-w-0 flex-col gap-4">
          <ConnectionNotice state={connection} />
          <LockAlertBanner alerts={data.lockAlerts} now={now} />
          <p
            className="live-mono text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--muted2)' }}
          >
            {data.sport} · {scope === 'my' ? 'your starters, sorted by leagues affected' : 'all games'}
          </p>
          {data.games.length === 0 ? (
            <EmptyState
              scope={scope}
              hasRosterData={data.hasRosterData}
              loadFailed={data.loadFailed}
              rosterFailed={data.rosterFailed}
            />
          ) : (
            orderedGames.map((game) => (
              <MatchupCard
                key={game.gameId}
                game={game}
                scope={scope}
                lastPlay={latestPlayByGame.get(game.gameId) ?? null}
                scoreChanged={litGames.has(game.gameId) && !lowData.lowData}
              />
            ))
          )}
        </main>
        <LiveImpactPanel
          impact={data.impact}
          hasRosterData={data.hasRosterData}
          rosterFailed={data.rosterFailed}
        />
      </div>
    </div>
  )
}

/**
 * ⚠ SAYS "UPDATED Ns AGO" ONLY WHEN IT KNOWS. An unparseable or missing
 * `fetchedAt` renders no age at all rather than "just now" — claiming freshness
 * we cannot demonstrate is the failure mode this page exists to avoid.
 *
 * ⚠ AND "MISSING" ONLY BECAME EXPRESSIBLE WHEN THE LOADER STOPPED INVENTING IT.
 * This docblock always promised the behaviour, but `fetchedAt` was typed
 * `string` and `getLivePageData` filled a failed or undated fetch with
 * `new Date().toISOString()` — so the missing case could not arrive and the
 * promise was never tested. `LivePageData.fetchedAt` is now `string | null`.
 *
 * The null check therefore has to run BEFORE `new Date`, not after: `new Date(null)`
 * is the EPOCH, not an invalid date, so `Number.isNaN` never catches it and the
 * badge would read "updated 20,000d ago" — a worse lie than the one this guard
 * was written to prevent.
 */
export function FreshnessBadge({
  fetchedAt,
  now,
  anyLive,
  isRefreshing,
  online = null,
  consecutiveFailures = 0,
  pollIntervalMs = LIVE_POLL_MS,
}: {
  fetchedAt: string | null
  now: number | null
  anyLive: boolean
  isRefreshing: boolean
  /*
   * ⚠ THE THREE CONNECTION INPUTS ARE OPTIONAL SO THIS STAYS THE SAME COMPONENT
   * IT WAS. Their defaults resolve to exactly the old two-state behaviour, which
   * is what lets the existing suite keep asserting the freshness rules it was
   * written for without being rewritten around a concern it is not about.
   */
  online?: boolean | null
  consecutiveFailures?: number
  pollIntervalMs?: number
}) {
  // No age when the loader could not date the feed, none before mount, and none
  // for an unparseable timestamp. All three render the badge without a claim
  // about freshness rather than with a wrong one.
  const at = fetchedAt == null ? null : new Date(fetchedAt).getTime()
  const ageSeconds =
    at == null || now == null || Number.isNaN(at)
      ? null
      : Math.max(0, Math.round((now - at) / 1000))

  const state = resolveConnectionState({
    online,
    consecutiveFailures,
    anyLive,
    ageSeconds,
    pollIntervalMs,
  })
  const fault = isConnectionFault(state)
  const detail = connectionDetail(state)

  /*
   * ⚠ A FAULT IS AMBER, A LIVE SLATE IS RED, AND THEY MUST NOT SHARE A COLOUR.
   * Red is this page's live-broadcast convention -- the one sanctioned non-alert
   * use of --bad in the system -- so painting "Reconnecting" red would read as a
   * game going live. Amber is the warning vocabulary the lock banner already uses.
   */
  const tone = fault ? 'var(--warn)' : anyLive ? 'var(--bad)' : null

  return (
    <span
      className="live-mono flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
      style={{
        background: tone ? `color-mix(in srgb, ${tone} 12%, transparent)` : 'var(--live-chip)',
        color: tone ?? 'var(--muted)',
        border: `1px solid ${tone ? `color-mix(in srgb, ${tone} 30%, transparent)` : 'var(--live-line2)'}`,
      }}
      /*
       * ⚠ `assertive` WHEN IT IS A FAULT. A screen-reader user who has lost the
       * feed is the one person who cannot see the numbers stop moving, so this is
       * the one case worth interrupting for; everything else stays polite.
       */
      aria-live={fault ? 'assertive' : 'polite'}
      title={detail ?? undefined}
    >
      {state === 'live' ? <span className="live-dot" aria-hidden="true" /> : null}
      {connectionLabel(state)}
      {ageSeconds != null ? <span>· updated {formatAge(ageSeconds)} ago</span> : null}
      {isRefreshing ? <span style={{ opacity: 0.7 }}>·</span> : null}
    </span>
  )
}

/**
 * The sentence under the header, shown only when the connection is at fault.
 *
 * ⚠ IT SAYS WHAT IS STILL TRUE, NOT JUST WHAT BROKE. The scores on screen are
 * real -- they are simply the last ones we received -- and a notice that omitted
 * that would leave the reader unsure whether to believe any of it.
 */
export function ConnectionNotice({ state }: { state: LiveConnectionState }) {
  const detail = connectionDetail(state)
  if (detail == null) return null

  return (
    <p
      className="live-display rounded-xl px-3 py-2 text-[12px]"
      style={{
        background: 'color-mix(in srgb, var(--warn) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--warn) 28%, transparent)',
        color: 'var(--muted)',
      }}
      role="status"
    >
      {detail}
    </p>
  )
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

/**
 * ⚠ "COULD NOT LOAD" AND "NOTHING IS ON" ARE DIFFERENT CLAIMS. An outage
 * rendered as an empty slate is a confident lie, and on a live-scoring page it
 * is the worst one available — the user concludes their players are not playing.
 */
function EmptyState({
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
      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: 'var(--panel)', border: '1px solid var(--live-line2)' }}
      >
        <p className="live-display text-[15px] font-bold" style={{ color: 'var(--bad)' }}>
          Scores could not be loaded.
        </p>
        <p className="live-display mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>
          This is a problem on our end, not an empty slate — there may well be games on. Retrying
          automatically.
        </p>
      </div>
    )
  }

  /*
   * ⚠ A ROSTER FAULT IS NOT AN EMPTY SLATE, AND SAYING SO IS THE WORSE ERROR.
   * Without this branch, a failed tie-in read falls through to "None of your
   * players are playing right now" plus "Claim a team in one of your leagues" —
   * told to someone who has claimed one and whose players may be on the field.
   * Checked AFTER loadFailed because a dead slate is the bigger fault; checked
   * BEFORE the normal state because that state asserts something we do not know.
   */
  if (rosterFailed) {
    return (
      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: 'var(--panel)', border: '1px solid var(--live-line2)' }}
      >
        <p className="live-display text-[15px] font-bold" style={{ color: 'var(--bad)' }}>
          We could not read your rosters.
        </p>
        <p className="live-display mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>
          The scores themselves are fine — this is a problem on our end, so we cannot say which
          games involve your players. Switch to All games to see the full slate meanwhile.
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-8 text-center"
      style={{ background: 'var(--panel)', border: '1px solid var(--live-line2)' }}
    >
      <p className="live-display text-[15px] font-bold">
        {scope === 'my' ? 'None of your players are playing right now.' : 'No games on this slate.'}
      </p>
      <p className="live-display mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>
        {scope === 'my' && !hasRosterData
          ? 'Claim a team in one of your leagues and this fills in automatically.'
          : scope === 'my'
            ? 'Switch to All games to see the rest of the slate.'
            : 'Nothing is scheduled in this window.'}
      </p>
    </div>
  )
}


/**
 * "Kicks off in 12m" -- the warning that a lineup decision is closing.
 *
 * ⚠ THE COUNTDOWN IS DERIVED HERE, FROM THIS BROWSER'S CLOCK, AND THAT IS
 * THE WHOLE REASON THE PAYLOAD CARRIES AN ABSOLUTE INSTANT. A server-rendered
 * "12m" is minted once and then handed to every later reader and every 20-second
 * poll; on the one element of this page where a stale number changes what someone
 * does, that is the worst available failure. Same rule as `FreshnessBadge`, higher
 * stakes.
 *
 * ⚠ AND IT FILTERS THE SERVER'S LIST RATHER THAN TRUSTING IT. The payload's
 * window was evaluated when the payload was built. A tab left open for ten minutes
 * holds kickoffs that have since passed, and counting one of those down to "0m"
 * tells the user they still have time to change a lineup that is already locked.
 * Anything not strictly in the future is dropped.
 *
 * ⚠ RENDERS NOTHING UNTIL THERE IS A CLOCK. `now` is null until mount (see
 * its note above); every figure here is relative to now, so there is nothing
 * honest to show before then, and computing it on the server would reintroduce the
 * hydration mismatch that note exists to record.
 */
export function LockAlertBanner({
  alerts,
  now,
}: {
  alerts: LiveLockAlert[]
  now: number | null
}) {
  if (now == null) return null
  /*
   * ⚠ A MISSING LIST MUST NOT TAKE THE SCOREBOARD DOWN. `lockAlerts` is a
   * required field, so this is unreachable through the type -- but it was reached
   * anyway, by two suites whose payload fixtures predate the field, and the result
   * was `undefined.map` unmounting the whole page. Tests are never typechecked in
   * this repo, so the type could not have caught it, and the same hole is open to
   * any hand-built payload. The page's standing rule applies: the warning is a
   * feature, the score is the product.
   */
  if (!Array.isArray(alerts)) return null

  const closing = alerts
    .map((alert) => ({ alert, msLeft: new Date(alert.kickoffAt).getTime() - now }))
    // NaN fails this comparison, so an unparseable kickoff is dropped rather than
    // rendered as a blank countdown.
    .filter(({ msLeft }) => msLeft > 0)

  if (closing.length === 0) return null

  return (
    <section
      className="rounded-2xl p-4"
      style={{
        background: 'color-mix(in srgb, var(--warn) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--warn) 32%, transparent)',
      }}
      /*
       * Announced, but never interrupting: this appears while the page is open and
       * the reader may be mid-sentence on a score.
       */
      aria-live="polite"
    >
      <h2
        className="live-mono mb-2 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: 'var(--warn)' }}
      >
        {closing.length === 1
          ? 'Lineup decision closing'
          : `${closing.length} lineup decisions closing`}
      </h2>

      <ul className="flex flex-col gap-2">
        {closing.map(({ alert, msLeft }) => (
          <li key={alert.gameId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="live-mono flex-none text-[13px] font-extrabold">{alert.matchup}</span>
            <span
              className="live-mono flex-none text-[13px] font-bold"
              style={{ color: 'var(--warn)' }}
            >
              kicks off in {formatCountdown(msLeft)}
            </span>
            <span className="live-display text-[12px]" style={{ color: 'var(--muted)' }}>
              {describeExposure(alert)}
            </span>
          </li>
        ))}
      </ul>

      {/*
        ⚠ THIS LINE IS NOT A DISCLAIMER, IT IS THE ACTION. AllFantasy cannot
        write a lineup back to any platform we import -- Sleeper's API is read-only
        -- so a warning that omitted it would tell someone to hurry without telling
        them where to go. It also says "kicks off", never "locks": a league on a
        weekly lock rule closed earlier than this and we cannot tell which leagues
        those are.
      */}
      <p className="live-display mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        Change it on your platform &mdash; AllFantasy cannot set your lineup for you. Leagues that
        lock weekly may already be closed.
      </p>
    </section>
  )
}

/**
 * Coarse on purpose: "43m", not "43m 12s". A ticking second counter on a warning
 * invites staring at it, and the figure is only actionable to the minute.
 */
function formatCountdown(msLeft: number): string {
  const totalMinutes = Math.floor(msLeft / 60_000)
  if (totalMinutes < 1) return 'under a minute'
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

/**
 * "2 benched, 1 starting · 2 leagues".
 *
 * ⚠ BENCH IS NAMED FIRST AND IS NEVER FOLDED INTO A TOTAL. It is the half
 * that is still a decision, where a starter is the choice already made. A bare
 * headcount would hide exactly the players the reader might still act on.
 */
function describeExposure(alert: LiveLockAlert): string {
  const parts: string[] = []
  if (alert.bench > 0) parts.push(`${alert.bench} benched`)
  if (alert.starters > 0) parts.push(`${alert.starters} starting`)
  const leagues =
    alert.leagues.length === 1 ? alert.leagues[0]!.leagueName : `${alert.leagues.length} leagues`
  return `${parts.join(', ')} · ${leagues}`
}
