"use client"

import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import "./af-playoff-bracket.css"
import type { PlayoffChallengeView, PlayoffSeriesView } from "@/lib/playoffs/types"
import {
  abbreviate,
  buildBracketGraph,
  roundLabel,
  seriesOdds,
  seriesRecordLine,
  seriesStatusKind,
  sideLabel,
  type BracketColumn,
  type BracketNode,
} from "@/lib/playoffs/playoffBracketGraph"
import { isPlaceholderName, teamColors } from "@/lib/playoffs/playoffTeamColors"
import { getPlayoffPickResult, roundPointsTable } from "@/lib/playoffs/playoffScoring"
import { getPlayoffSeriesLockedReason } from "@/lib/playoffs/playoffLocking"
import {
  buildProjectedPlayoffSeries,
  isOfficialTeamName,
} from "@/lib/playoffs/playoffBracketProjection"
import PlayoffLiveViewModal from "./PlayoffLiveViewModal"
import SingleGameMatchupModal from "./SingleGameMatchupModal"
import PlayoffDecisionRail from "./PlayoffDecisionRail"
import { TeamLogo } from "@/app/components/TeamLogo"
import { nbaCupLockedReason } from "@/lib/playoffs/nbaCupTournament"

/**
 * Shared mirrored bracket for MLB, CFP and NBA Cup.
 *
 * ⚠ THE TREE IS DERIVED, NOT DECLARED. Columns, edges and the centre final all
 * come from `buildBracketGraph`, which reads the series rows' own
 * `sourceSeriesHome` / `sourceSeriesAway`. The design prototype carried a
 * hard-coded node graph; duplicating it here would be a second source of truth
 * for a shape the template already owns.
 *
 * ⚠ THE CASCADE IS THE SERVER'S JOB. Clicking a team POSTs one pick and the
 * route returns the whole refreshed view — `savePlayoffBracketPick` already
 * deletes every downstream pick in the same transaction. Clearing children
 * locally too would be a second implementation of that rule, and the two would
 * disagree the first time the bracket shape changed.
 *
 * 🛑 THE TREE RENDERS THE *PROJECTED* SERIES, NOT THE RAW ROWS, AND DROPPING
 * THAT BREAKS SUBMISSION. Later rounds hold `Winner S5` until the provider
 * advances them, so on raw rows a Division-round card is permanently TBD and
 * unpickable — and a pool on the default `full_bracket_required` rule can then
 * never be submitted at all. `buildProjectedPlayoffSeries` carries the entry's
 * own picks forward, which is the same projection the NBA/NHL board has always
 * used.
 */

export type MlbBracketBoardProps = {
  view: PlayoffChallengeView
  onViewChange: (view: PlayoffChallengeView) => void
  onOpenSettings?: () => void
  /** Rendered beside the pick counter — the entry shell puts Submit here. */
  actions?: ReactNode
  /** Back link in the hero, so the board can stand alone on its own route. */
  backHref?: string
  backLabel?: string
}

/**
 * 🛑 "PICKABLE" AND "IS A REAL CLUB" ARE DIFFERENT QUESTIONS AND THIS ONE IS
 * THE FIRST. An unseeded pool renders `AL1`…`NL6`, and those slots ARE
 * pickable — `applyPlayoffSeedsToChallenge` migrates a pick that named a slot
 * onto the club that lands in it once standings close. Gating the row on "is
 * this a club we hold colours for" would quietly delete that whole flow, and
 * an empty-looking bracket is exactly what a pool looks like before seeding.
 *
 * `isPlaceholderName` stays in use for the BADGE, where the question really is
 * "do we have a club identity", and a seed slot correctly draws neutral.
 */
function isOfficial(name: string | null | undefined): boolean {
  return isOfficialTeamName(name) && !/^(?:CFP|EAST|WEST)\d+$/i.test(name ?? "")
}

function TeamRow({
  series,
  side,
  picked,
  locked,
  onPick,
  showProb,
  sport,
  teamLogos,
  openDetail = false,
}: {
  series: PlayoffSeriesView
  side: "home" | "away"
  picked: string | null
  locked: string | null
  onPick: (teamName: string) => void
  showProb: boolean
  sport: string
  teamLogos: Record<string, string>
  openDetail?: boolean
}) {
  const name = side === "home" ? series.homeTeamName : series.awayTeamName
  const seed = side === "home" ? series.homeSeed : series.awaySeed
  const odds = seriesOdds(series)
  const prob = side === "home" ? odds.home : odds.away
  const official = isOfficial(name)
  const isPicked = !!picked && picked === name
  const decided = !!series.winnerTeamName
  const eliminated = decided && series.winnerTeamName !== name
  const colors = teamColors(abbreviate(name))
  const disabled = !openDetail && (!official || !!locked)
  const tournamentLogoSport = sport === "ncaaf" ? "NCAAF" : sport === "nba_cup" ? "NBA_CUP" : null
  const showTeamLogo = Boolean(tournamentLogoSport && official && !/^(?:CFP|EAST|WEST)\d+$/i.test(name))

  return (
    <button
      type="button"
      className="af-pb-team"
      data-picked={isPicked ? "true" : undefined}
      data-eliminated={eliminated ? "true" : undefined}
      disabled={disabled}
      aria-pressed={isPicked}
      aria-label={openDetail ? `Open ${series.homeTeamName} versus ${series.awayTeamName} matchup` :
        official
          ? `Pick ${name}${seed ? `, seed ${seed}` : ""}${locked ? ` — ${locked}` : ""}`
          : "Awaiting an earlier result"
      }
      title={locked ?? undefined}
      onClick={() => openDetail ? onPick(String(name)) : official && !locked && onPick(String(name))}
    >
      <span className="af-pb-team-seed af-pb-mono">{seed > 0 ? seed : ""}</span>
      {showTeamLogo ? (
        <TeamLogo teamAbbr={name} sport={tournamentLogoSport!} logoUrl={teamLogos[name] ?? null} size={22} />
      ) : (
        <span className="af-pb-badge af-pb-badge--sm" style={{ background: colors.bg, color: colors.fg }} aria-hidden="true">
          {official ? abbreviate(name) : "?"}
        </span>
      )}
      <span className="af-pb-team-name" title={official ? name : undefined}>{official ? tournamentLogoSport ? name : abbreviate(name) : "TBD"}</span>
      {official && isPlaceholderName(name) ? (
        <span className="af-pb-team-slot">slot</span>
      ) : null}
      {showProb && official && odds.basis !== "unknown" ? (
        <span className="af-pb-team-prob af-pb-mono">{prob}%</span>
      ) : null}
    </button>
  )
}

export default function MlbBracketBoard({
  view,
  onViewChange,
  onOpenSettings,
  actions,
  backHref,
  backLabel,
}: MlbBracketBoardProps) {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [liveNode, setLiveNode] = useState<string | null>(null)

  const sport = String(view.challenge.sport ?? "").toLowerCase()
  const tournamentLogoSport = sport === "ncaaf" ? "NCAAF" : sport === "nba_cup" ? "NBA_CUP" : null
  const teamLogos = view.teamLogos ?? {}
  const singleGame = !view.challenge.isTestMode && (sport === "ncaaf" || sport === "nba_cup")
  const rollingCup = singleGame && sport === "nba_cup"
  const firstStart = view.challenge.firstGameStartsAt ? Date.parse(view.challenge.firstGameStartsAt) : null
  const tournamentLocked = singleGame && !rollingCup && firstStart != null && Date.now() >= firstStart
  const requiresPublishedField = !view.challenge.isTestMode && sport === "ncaaf"
  const waitingForField = requiresPublishedField && view.series.some((row) =>
    /^(?:CFP|EAST|WEST)\d+$/i.test(row.homeTeamName) || /^(?:CFP|EAST|WEST)\d+$/i.test(row.awayTeamName))
  const waitingForSchedule = requiresPublishedField && view.series.some((row) => !row.startsAt)
  const bracketReady = !waitingForField && !waitingForSchedule
  const projectedSeries = useMemo(
    () => rollingCup ? view.series : buildProjectedPlayoffSeries(view.series, view.picks, { includeUserPicks: true }),
    [view.series, view.picks, rollingCup],
  )
  const graph = useMemo(() => buildBracketGraph(projectedSeries.filter((game) => game.round !== "cup_group_play")), [projectedSeries])
  const [groupFilter, setGroupFilter] = useState<"upcoming" | "all">("upcoming")
  const groupGames = projectedSeries.filter((game) => game.round === "cup_group_play")
    .filter((game) => groupFilter === "all" || !nbaCupLockedReason(game))
    .sort((a, b) => Date.parse(a.startsAt ?? "") - Date.parse(b.startsAt ?? ""))
  const entryId = view.activeEntry?.id ?? null
  const picksBySeries = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of view.picks) m.set(p.seriesId, p.pickTeamName)
    return m
  }, [view.picks])
  /** The un-projected rows, for anything that must not treat a pick as a result. */
  const rawById = useMemo(() => {
    const m = new Map<string, PlayoffSeriesView>()
    for (const s of view.series) m.set(s.id, s)
    return m
  }, [view.series])

  const lockRule = view.challenge.lockRule ?? null
  const canLatePick = view.lockDiagnostics?.viewerCanLatePick ?? false

  const savePick = useCallback(
    async (series: PlayoffSeriesView, teamName: string) => {
      if (rollingCup) {
        const reason = nbaCupLockedReason(series)
        if (reason) { setError(reason); return false }
      }
      if (!bracketReady) {
        setError("Official teams and game times must be published before picks open.")
        return false
      }
      if (tournamentLocked) {
        setError("Brackets locked when the first game began.")
        return false
      }
      if (!entryId) {
        setError("Create an entry before making picks.")
        return false
      }
      setError(null)
      setSaving(series.id)
      try {
        const res = await fetch(
          `/api/brackets/playoffs/${view.challenge.id}/entries/${entryId}/picks`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ seriesId: series.id, pickTeamName: teamName }),
          },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(String(data?.error ?? "Could not save that pick."))
          return false
        }
        /*
         * The route hands back the whole recomputed view, which already has
         * every downstream pick cleared. Taking it wholesale is what keeps the
         * cascade in one place.
         */
        if (data?.view) onViewChange(data.view as PlayoffChallengeView)
        return true
      } catch {
        setError("Could not reach the server. Your pick was not saved.")
        return false
      } finally {
        setSaving(null)
      }
    },
    [bracketReady, entryId, onViewChange, tournamentLocked, view.challenge.id, rollingCup],
  )

  const totalSeries = view.series.length
  const pickedCount = view.picks.length
  const tiles = roundPointsTable(sport)

  // Seeds per half, read off the first-round and bye rows rather than invented.
  const seedsBySide = useMemo(() => {
    const out = new Map<string, Map<number, string>>()
    for (const s of view.series) {
      const conf = String(s.conference ?? "").toLowerCase()
      if (!conf || conf === "finals") continue
      const bucket = out.get(conf) ?? new Map<number, string>()
      for (const [seed, name] of [
        [s.homeSeed, s.homeTeamName],
        [s.awaySeed, s.awayTeamName],
      ] as const) {
        if (Number(seed) > 0 && isOfficial(name)) bucket.set(Number(seed), String(name))
      }
      out.set(conf, bucket)
    }
    return out
  }, [view.series])

  const lockedReasonFor = useCallback(
    (s: PlayoffSeriesView) => rollingCup ? nbaCupLockedReason(s) : tournamentLocked ? "Tournament locked at the first game" :
      getPlayoffSeriesLockedReason(s, lockRule, { hasPoolAdminAccess: singleGame ? false : canLatePick }),
    [canLatePick, lockRule, singleGame, tournamentLocked, rollingCup],
  )

  const renderMatch = (node: BracketNode) => {
    const s = node.series
    const resolved = isOfficial(s.homeTeamName) && isOfficial(s.awayTeamName)
    const kind = seriesStatusKind(s, resolved)
    const locked = lockedReasonFor(s)
    return (
      <div className="af-pb-match" key={s.id} data-testid={`pb-series-${s.seriesNumber}`}>
        {singleGame ? <button type="button" className="af-pb-game-meta" onClick={() => setLiveNode(s.id)}>{s.gameLabel || (sport === "ncaaf" && s.roundIndex > 1 && s.roundIndex < 4 ? "Bowl TBA" : roundLabel(sport, s.round))}<span>{s.startsAt ? new Date(s.startsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Time TBA"}</span></button> : null}
        <TeamRow
          series={s}
          side="home"
          picked={picksBySeries.get(s.id) ?? null}
          locked={locked}
          onPick={(t) => singleGame ? setLiveNode(s.id) : void savePick(s, t)}
          showProb={kind !== "tbd"}
          sport={sport}
          teamLogos={teamLogos}
          openDetail={singleGame}
        />
        <TeamRow
          series={s}
          side="away"
          picked={picksBySeries.get(s.id) ?? null}
          locked={locked}
          onPick={(t) => singleGame ? setLiveNode(s.id) : void savePick(s, t)}
          showProb={kind !== "tbd"}
          sport={sport}
          teamLogos={teamLogos}
          openDetail={singleGame}
        />
        {saving === s.id ? (
          <div className="af-pb-status-sub" style={{ padding: "4px 0 6px" }}>
            Saving…
          </div>
        ) : null}
      </div>
    )
  }

  const renderStatusCell = (node: BracketNode | undefined) => {
    if (!node) return <div />
    const s = node.series
    /*
     * Two different questions, and conflating them is how a projection starts
     * reading as a result: `resolved` asks whether the CARD has two teams to
     * show (a user's picks count), `official` asks whether the PROVIDER has
     * filled the matchup. Only the second may open the detail sheet, because
     * that sheet shows venue, broadcast and live score — none of which exist
     * for a series the schedule has not produced yet.
     */
    const raw = rawById.get(s.id) ?? s
    const resolved = isOfficial(s.homeTeamName) && isOfficial(s.awayTeamName)
    const official = isOfficial(raw.homeTeamName) && isOfficial(raw.awayTeamName)
    const kind = seriesStatusKind(s, resolved)
    const record = seriesRecordLine(s)
    const odds = seriesOdds(s)
    const result = getPlayoffPickResult(raw, view.picks.find((p) => p.seriesId === s.id), sport)

    let title = "TBD"
    let sub = "pick a winner first"
    if (kind === "final") {
      title = s.winnerTeamName ? `${abbreviate(s.winnerTeamName)} win` : "Final"
      sub = record ?? "series complete"
    } else if (kind === "live") {
      title = record ?? "In progress"
      sub = s.liveStatus ?? "live"
    } else if (kind === "scheduled") {
      title = record ?? `${odds.home}% – ${odds.away}%`
      sub = official ? s.nextGameDateLabel ?? "pregame" : "your projection"
    }

    return (
      <button
        type="button"
        className="af-pb-status-cell"
        disabled={!official && !singleGame}
        onClick={() => setLiveNode(s.id)}
        aria-label={`${roundLabel(sport, s.round)} series detail`}
        data-testid={`pb-status-${s.seriesNumber}`}
      >
        <span className="af-pb-status-title">
          {kind === "live" ? <span className="af-pb-live-dot" aria-hidden="true" /> : null}
          {title}
        </span>
        <span className="af-pb-status-sub">{sub}</span>
        {result.status === "correct" || result.status === "wrong" ? (
          <span className="af-pb-status-result" data-result={result.status}>
            {result.status === "correct" ? `Your pick ✓ +${result.points}` : "Your pick ✕"}
          </span>
        ) : null}
      </button>
    )
  }

  const finalNode = graph.final
  const champion = finalNode?.series.winnerTeamName ?? (finalNode ? picksBySeries.get(finalNode.series.id) : null)
  const champColors = teamColors(abbreviate(champion))

  const leftCols = graph.columns.filter((c) => c.side === "left")
  const rightCols = graph.columns.filter((c) => c.side === "right")

  /**
   * A status strip sits in the gutter between two rounds and reports the
   * LOWER round's series — the one whose winner flows inward. That is the same
   * rule on both halves, which is what makes the layout read as a mirror
   * rather than as two different diagrams.
   */
  const statusColumn = (col: BracketColumn | undefined) => {
    if (!col) return <div />
    return (
      <div className="af-pb-col">
        {col.nodes.map((n) => (
          <div key={`st-${n.series.seriesNumber}`}>{renderStatusCell(n)}</div>
        ))}
      </div>
    )
  }

  /*
   * ⚠ THE GRID TRACKS ARE COMPUTED, NOT COUNTED OUT BY HAND. The stylesheet
   * carries a 3-round default, and a template with a different number of
   * rounds would silently overflow it — the columns would wrap or collapse
   * with nothing to indicate the layout no longer matches the bracket. Built
   * from the column count, the track list cannot disagree with what renders.
   */
  const trackList = (count: number) =>
    count === 0 ? [] : Array.from({ length: count * 2 - 1 }, (_, i) => (i % 2 === 0 ? "150px" : "96px"))
  const gridTemplateColumns = [...trackList(leftCols.length), "250px", ...trackList(rightCols.length)].join(" ")

  return (
    <div className="af-pb">
      <header className="af-pb-hero">
        <div className="af-pb-hero-top">
          <div>
            {backHref ? (
              <Link href={backHref} className="af-pb-back">
                ← {backLabel ?? "Back"}
              </Link>
            ) : null}
            <h1 className="af-pb-title">
              {view.challenge.name}
              <span className="af-pb-season af-pb-mono">{view.challenge.seasonYear}</span>
            </h1>
            <p className="af-pb-sub">
              {sport === "nba_cup" ? "30 teams · Group Play + 8-team knockout" : `12 teams · ${view.rounds.length} rounds`} · {singleGame ? "tap any matchup for Chimmy Intelligence and your pick" : "tap a matchup to pick a winner"}
            </p>
            {!bracketReady ? <p className="af-pb-sub" role="status">Official teams and game times are pending. Picks open when both are published.</p> : null}
            {rollingCup ? <p className="af-pb-sub" role="status">Join anytime. Each game locks at tipoff. Missed games earn 0 points. Teams, times, and knockout matchups update automatically.</p> : singleGame && bracketReady ? <p className="af-pb-sub" role="status">Changes are allowed until the first game starts{view.challenge.firstGameStartsAt ? `: ${new Date(view.challenge.firstGameStartsAt).toLocaleString()}` : ""}. Editing after finalizing returns this bracket to Draft.</p> : null}
            {singleGame && view.activeEntry?.finalizedAt ? <p className="af-pb-sub">{rollingCup ? "✓ Picks finalized. Changes to upcoming games save automatically; locked picks and earned points stay in place." : "✓ Picks finalized. You can revise and finalize again before kickoff."}</p> : null}
          </div>
          <div className="af-pb-status">
            {!bracketReady ? "Field or schedule pending" : tournamentLocked ? "Brackets locked" : view.challenge.status === "open" ? "Picks open" : String(view.challenge.status)}
            <small>{lockRule ? `Locks: ${lockRule.replace(/_/g, " ")}` : "Pool is live"}</small>
          </div>
        </div>

        <div className="af-pb-actions">
          <div className="af-pb-progress af-pb-mono" data-testid="pb-progress">
            <span>
              {pickedCount}/{totalSeries} picked
            </span>
            <span>{view.activeEntry?.totalScore ?? 0} pts</span>
          </div>
          {onOpenSettings ? (
            <button type="button" className="af-pb-btn" onClick={onOpenSettings}>
              Settings
            </button>
          ) : null}
          {actions}
        </div>
        {error ? (
          <p role="alert" style={{ color: "var(--pb-bad)", fontSize: 12, marginTop: 10 }}>
            {error}
          </p>
        ) : null}
        {singleGame ? <p className="af-pb-note">No prizes, gambling, betting, entry fees, or payouts are offered by AllFantasy. Paid plans only allow extra brackets.</p> : null}
      </header>

      <div className="af-pb-body">
        <div className="af-pb-main">
          {rollingCup ? <section className="af-pb-card af-pb-cup-group" aria-label="NBA Cup Group Play">
            <div className="af-pb-cup-group-heading">
              <div><h2>Group Play</h2><p>1 point per correct pick · Tap a game for Chimmy Intelligence</p></div>
              <div className="af-pb-cup-filters" aria-label="Group Play filter">
                <button type="button" className="af-pb-btn" aria-pressed={groupFilter === "upcoming"} onClick={() => setGroupFilter("upcoming")}>Upcoming</button>
                <button type="button" className="af-pb-btn" aria-pressed={groupFilter === "all"} onClick={() => setGroupFilter("all")}>All games</button>
              </div>
            </div>
            {groupGames.length ? <div className="af-pb-cup-games">{groupGames.map((game) => <div key={game.id}>
              {renderMatch({ series: game, roundIndex: 0, side: "left", sourceHome: null, sourceAway: null })}
              <p className="af-pb-cup-game-footer">{game.venue || "Venue pending"}{game.location ? ` · ${game.location}` : ""}<br />
                {game.winnerTeamName ? `${game.winnerTeamName} won` : nbaCupLockedReason(game) || (picksBySeries.has(game.id) ? "✓ Pick saved" : "Choose your winner")}
              </p>
            </div>)}</div> : <p className="af-pb-note" role="status">{projectedSeries.some((game) => game.round === "cup_group_play") ? "No upcoming group games right now. View all games or check the knockout bracket below." : "Confirmed Cup games will appear here automatically as the schedule syncs. You can create your bracket now."}</p>}
          </section> : null}
          <section className="af-pb-card">
            {rollingCup ? <div className="af-pb-cup-group-heading"><div><h2>Knockout Bracket</h2><p>Quarterfinals → Semifinals → Championship. Matchups open as qualifiers are confirmed.</p></div></div> : null}
            {/* Seeding strip */}
            <div className="af-pb-seeds">
              {[graph.sides.left, graph.sides.right].filter(Boolean).map((conf) => {
                const seeds = seedsBySide.get(String(conf)) ?? new Map<number, string>()
                const label = sideLabel(String(conf))
                return (
                  <div className="af-pb-seed-row" key={String(conf)}>
                    <span className="af-pb-seed-league af-pb-mono" title={label}>
                      {String(conf).toUpperCase()}
                    </span>
                    {Array.from(seeds.keys()).sort((a, b) => a - b).map((seed) => {
                      const name = seeds.get(seed)
                      const c = teamColors(abbreviate(name))
                      return (
                        <span className="af-pb-seed" key={seed}>
                          <span className="af-pb-seed-n af-pb-mono">{seed}</span>
                          {tournamentLogoSport && name && !/^(?:CFP|EAST|WEST)\d+$/i.test(name) ? (
                            <TeamLogo teamAbbr={name} sport={tournamentLogoSport} logoUrl={teamLogos[name] ?? null} size={22} />
                          ) : (
                            <span className="af-pb-badge af-pb-badge--sm" style={{ background: c.bg, color: c.fg }}>
                              {name ? abbreviate(name) : "—"}
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* Scoring tiles — values come from the scorer, so they cannot drift */}
            {tiles.length > 0 ? (
              <div className="af-pb-tiles" data-testid="pb-scoring-tiles">
                {tiles.map((t, i) => {
                  const example = view.series.find((s) => s.round === t.round)
                  return (
                    <div
                      className={`af-pb-tile${i === tiles.length - 1 ? " af-pb-tile--accent" : ""}`}
                      key={t.round}
                    >
                      <div className="af-pb-tile-name">{roundLabel(sport, t.round)}</div>
                      <div className="af-pb-tile-pts af-pb-mono">{t.points} pts</div>
                      <div className="af-pb-tile-meta">
                        {example ? example.bestOf === 1 ? "Single game" : `Best of ${example.bestOf}` : ""}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {/* The tree */}
            <p className="af-pb-scroll-cue" role="note">← Scroll or swipe to see every round →</p>
            <div className="af-pb-scroller" data-testid="pb-scroller">
              <div className="af-pb-tree" style={{ gridTemplateColumns }}>
                {/* Left half, outward-in: match column, gutter, match column… */}
                {leftCols.map((col, i) => (
                  <Fragment key={`L${col.roundIndex}`}>
                    <div className="af-pb-col">
                      <div className="af-pb-col-head">{roundLabel(sport, col.round)}</div>
                      {col.nodes.map(renderMatch)}
                    </div>
                    {i < leftCols.length - 1 ? statusColumn(col) : null}
                  </Fragment>
                ))}

                {/* Centre: the final */}
                <div className="af-pb-champ" data-testid="pb-champion">
                  <div className="af-pb-champ-label">
                    {finalNode ? roundLabel(sport, finalNode.series.round) : "Final"}
                  </div>
                  {champion && isOfficial(champion) ? (
                    <span
                      className="af-pb-badge af-pb-badge--champ"
                      style={{ background: champColors.bg, color: champColors.fg }}
                    >
                      {tournamentLogoSport ? (
                        <TeamLogo teamAbbr={champion} sport={tournamentLogoSport} logoUrl={teamLogos[champion] ?? null} size={96} />
                      ) : abbreviate(champion)}
                    </span>
                  ) : (
                    <div className="af-pb-champ-empty">{rollingCup ? "Championship picks open when the finalists are confirmed" : tournamentLogoSport ? "Pick both finalists to crown a champion" : "Pick both pennants to crown a champion"}</div>
                  )}
                  {finalNode ? renderMatch(finalNode) : null}
                </div>

                {/* Right half, inward-out — the mirror of the left */}
                {rightCols.map((col, i) => (
                  <Fragment key={`R${col.roundIndex}`}>
                    <div className="af-pb-col">
                      <div className="af-pb-col-head">{roundLabel(sport, col.round)}</div>
                      {col.nodes.map(renderMatch)}
                    </div>
                    {i < rightCols.length - 1 ? statusColumn(rightCols[i + 1]) : null}
                  </Fragment>
                ))}
              </div>
            </div>

            <p className="af-pb-footnote">
              {singleGame
                ? rollingCup ? "Each NBA Cup game locks at tipoff. Finalize before your first selected game begins; later changes to upcoming games save automatically. AllFantasy offers no prizes or gambling." : "Chimmy estimates disclose their source. Tap a matchup for verified season stats, game details, and picks. Brackets lock at the first game. AllFantasy offers no prizes or gambling."
                : "Percentages are a seed-and-record read, not a scouting model. Seeds 1 and 2 in each league hold a bye and enter at the Division round, so their opponent stays unknown until the Wild Card round resolves. The bracket scrolls sideways on a phone."}
            </p>
          </section>
        </div>

        <aside className="af-pb-rail">
          <PlayoffDecisionRail view={view} graph={graph} sport={sport} />
        </aside>
      </div>

      {liveNode ? singleGame ? (() => {
        const modalSeries = projectedSeries.find((item) => item.id === liveNode)
        return modalSeries ? <SingleGameMatchupModal
          series={modalSeries} sport={sport} profiles={view.teamProfiles ?? {}} teamLogos={teamLogos}
          picked={picksBySeries.get(liveNode) ?? null}
          locked={!bracketReady || Boolean(lockedReasonFor(modalSeries))}
          saving={saving === liveNode}
          onPick={(team) => { void savePick(modalSeries, team).then((ok) => { if (ok) setLiveNode(null) }) }}
          onClose={() => setLiveNode(null)}
        /> : null
      })() : (
        <PlayoffLiveViewModal
          series={view.series.find((item) => item.id === liveNode) ?? null}
          sport={sport}
          onClose={() => setLiveNode(null)}
        />
      ) : null}
    </div>
  )
}
