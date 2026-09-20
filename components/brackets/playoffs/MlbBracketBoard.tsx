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
import PlayoffDecisionRail from "./PlayoffDecisionRail"

/**
 * The MLB postseason bracket.
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
  return isOfficialTeamName(name)
}

function TeamRow({
  series,
  side,
  picked,
  locked,
  onPick,
  showProb,
}: {
  series: PlayoffSeriesView
  side: "home" | "away"
  picked: string | null
  locked: string | null
  onPick: (teamName: string) => void
  showProb: boolean
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
  const disabled = !official || !!locked

  return (
    <button
      type="button"
      className="af-pb-team"
      data-picked={isPicked ? "true" : undefined}
      data-eliminated={eliminated ? "true" : undefined}
      disabled={disabled}
      aria-pressed={isPicked}
      aria-label={
        official
          ? `Pick ${name}${seed ? `, seed ${seed}` : ""}${locked ? ` — ${locked}` : ""}`
          : "Awaiting an earlier result"
      }
      title={locked ?? undefined}
      onClick={() => official && !locked && onPick(String(name))}
    >
      <span className="af-pb-team-seed af-pb-mono">{seed > 0 ? seed : ""}</span>
      <span
        className="af-pb-badge af-pb-badge--sm"
        style={{ background: colors.bg, color: colors.fg }}
        aria-hidden="true"
      >
        {official ? abbreviate(name) : "?"}
      </span>
      <span className="af-pb-team-name">{official ? abbreviate(name) : "TBD"}</span>
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
  const projectedSeries = useMemo(
    () => buildProjectedPlayoffSeries(view.series, view.picks, { includeUserPicks: true }),
    [view.series, view.picks],
  )
  const graph = useMemo(() => buildBracketGraph(projectedSeries), [projectedSeries])
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
      if (!entryId) {
        setError("Create an entry before making picks.")
        return
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
          return
        }
        /*
         * The route hands back the whole recomputed view, which already has
         * every downstream pick cleared. Taking it wholesale is what keeps the
         * cascade in one place.
         */
        if (data?.view) onViewChange(data.view as PlayoffChallengeView)
      } catch {
        setError("Could not reach the server. Your pick was not saved.")
      } finally {
        setSaving(null)
      }
    },
    [entryId, onViewChange, view.challenge.id],
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
    (s: PlayoffSeriesView) =>
      getPlayoffSeriesLockedReason(s, lockRule, { hasPoolAdminAccess: canLatePick }),
    [canLatePick, lockRule],
  )

  const renderMatch = (node: BracketNode) => {
    const s = node.series
    const resolved = isOfficial(s.homeTeamName) && isOfficial(s.awayTeamName)
    const kind = seriesStatusKind(s, resolved)
    const locked = lockedReasonFor(s)
    return (
      <div className="af-pb-match" key={s.id} data-testid={`pb-series-${s.seriesNumber}`}>
        <TeamRow
          series={s}
          side="home"
          picked={picksBySeries.get(s.id) ?? null}
          locked={locked}
          onPick={(t) => savePick(s, t)}
          showProb={kind !== "tbd"}
        />
        <TeamRow
          series={s}
          side="away"
          picked={picksBySeries.get(s.id) ?? null}
          locked={locked}
          onPick={(t) => savePick(s, t)}
          showProb={kind !== "tbd"}
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
        disabled={!official}
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
              12 teams · 4 rounds · tap a matchup to pick a winner · tap a series line for detail
            </p>
          </div>
          <div className="af-pb-status">
            {view.challenge.status === "open" ? "Picks open" : String(view.challenge.status)}
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
      </header>

      <div className="af-pb-body">
        <div className="af-pb-main">
          <section className="af-pb-card">
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
                    {Array.from({ length: 6 }, (_, i) => i + 1).map((seed) => {
                      const name = seeds.get(seed)
                      const c = teamColors(abbreviate(name))
                      return (
                        <span className="af-pb-seed" key={seed}>
                          <span className="af-pb-seed-n af-pb-mono">{seed}</span>
                          <span
                            className="af-pb-badge af-pb-badge--sm"
                            style={{ background: c.bg, color: c.fg }}
                          >
                            {name ? abbreviate(name) : "—"}
                          </span>
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
                        {example ? `Best of ${example.bestOf}` : ""}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {/* The tree */}
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
                      {abbreviate(champion)}
                    </span>
                  ) : (
                    <div className="af-pb-champ-empty">Pick both pennants to crown a champion</div>
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
              Percentages are a seed-and-record read, not a scouting model. Seeds 1 and 2 in each
              league hold a bye and enter at the Division round, so their opponent stays unknown
              until the Wild Card round resolves. The bracket scrolls sideways on a phone — that is
              deliberate, a bracket read as a list stops being a bracket.
            </p>
          </section>
        </div>

        <aside className="af-pb-rail">
          <PlayoffDecisionRail view={view} graph={graph} sport={sport} />
        </aside>
      </div>

      {liveNode ? (
        <PlayoffLiveViewModal
          series={view.series.find((s) => s.id === liveNode) ?? null}
          sport={sport}
          onClose={() => setLiveNode(null)}
        />
      ) : null}
    </div>
  )
}
