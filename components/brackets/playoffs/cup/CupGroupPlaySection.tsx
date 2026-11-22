"use client"

import { useMemo, useState } from "react"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import { cupGameDetail, cupGameState, cupLiveClock, cupTeamCode, groupForTeam, type CupGroup } from "@/lib/playoffs/nbaCupBoard"
import CupGameCard from "./CupGameCard"
import { dayHeading, localDayKey } from "./cupFormat"
import { useClientTime } from "./useClientTime"
import "./af-nba-cup.css"

type Filter = "next" | "results" | "all"

type CupGroupPlaySectionProps = {
  scoringExcludedReasonFor?: (game: PlayoffSeriesView) => "draft" | "late" | null
  games: PlayoffSeriesView[]
  allGames?: PlayoffSeriesView[]
  groups: CupGroup[]
  sport: string
  picks: Map<string, string>
  pendingIds: Set<string>
  canFinalize: boolean
  finalizingDay: string | null
  onFinalizeDay: (day: string) => void
  teamLogos: Record<string, string>
  savingId: string | null
  lockedReasonFor: (game: PlayoffSeriesView) => string | null
  onPick: (game: PlayoffSeriesView, team: string) => void
  onOpen: (game: PlayoffSeriesView) => void
}

const STATE_ORDER = { live: 0, scheduled: 1, final: 2 } as const

function startMs(game: PlayoffSeriesView): number {
  const ms = Date.parse(game.startsAt ?? "")
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER
}

/**
 * Group Play, one day at a time, with live games first. The default view is
 * "Live & upcoming"; finished games move to Results so the next pick is always
 * at the top.
 */
export default function CupGroupPlaySection({ games, allGames = games, groups, sport, picks, pendingIds, canFinalize, finalizingDay, onFinalizeDay, teamLogos, savingId, lockedReasonFor, onPick, onOpen, scoringExcludedReasonFor }: CupGroupPlaySectionProps) {
  const [filter, setFilter] = useState<Filter>("next")
  const [selectedDay, setSelectedDay] = useState("all")
  const clientTime = useClientTime()
  const live = useMemo(() => games.filter((g) => cupGameState(g) === "live").sort((a, b) => startMs(a) - startMs(b)), [games])
  const finals = games.filter((g) => cupGameState(g) === "final").length

  const recordOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of groups) for (const row of group.teams) map.set(row.team, `${row.wins}-${row.losses}`)
    return (team: string) => map.get(team) ?? null
  }, [groups])

  const days = useMemo(() => {
    const shown = games.filter((g) => {
      const state = cupGameState(g)
      return filter === "all" || (filter === "results" ? state === "final" : state !== "final")
    })
    const byDay = new Map<string, PlayoffSeriesView[]>()
    for (const game of shown) {
      const key = localDayKey(game.startsAt, clientTime ? undefined : "UTC")
      byDay.set(key, [...(byDay.get(key) ?? []), game])
    }
    const keys = [...byDay.keys()].sort((a, b) => (a === "tba" ? 1 : b === "tba" ? -1 : a.localeCompare(b)))
    if (filter === "results") keys.reverse()
    return keys.map((key) => {
      const list = byDay.get(key)!.sort((a, b) => STATE_ORDER[cupGameState(a)] - STATE_ORDER[cupGameState(b)] || startMs(a) - startMs(b))
      const liveCount = list.filter((g) => cupGameState(g) === "live").length
      const finalCount = list.filter((g) => cupGameState(g) === "final").length
      const correct = list.filter((g) => cupGameState(g) === "final" && g.winnerTeamName && picks.get(g.id) === g.winnerTeamName).length
      const picked = list.filter((g) => picks.has(g.id) && cupGameState(g) === "final").length
      const bits = [
        `${list.length} game${list.length === 1 ? "" : "s"}`,
        liveCount ? `${liveCount} live` : null,
        finalCount && picked ? `${correct} of ${picked} picks right` : null,
      ].filter(Boolean)
      return { key, heading: dayHeading(key, undefined, clientTime ? undefined : "UTC", clientTime), sub: bits.join(" · "), list }
    })
  }, [games, filter, picks, clientTime])

  const groupLabel = (game: PlayoffSeriesView) => groupForTeam(groups, game.homeTeamName)?.label ?? null
  const schedule = days.map((day) => {
    const open = allGames.filter((game) => localDayKey(game.startsAt, clientTime ? undefined : "UTC") === day.key && !lockedReasonFor(game))
    return { ...day, openCount: open.length, savedCount: open.filter((game) => picks.has(game.id)).length, pendingCount: open.filter((game) => pendingIds.has(game.id)).length }
  })
  const visibleSchedule = schedule.some((day) => day.key === selectedDay)
    ? schedule.filter((day) => day.key === selectedDay)
    : schedule

  return (
    <section className="af-pb-card af-pb-cup-group af-cup" aria-label="NBA Cup Group Play">
      <div className="af-pb-cup-group-heading">
        <div>
          <h2>Group Play</h2>
          <p>Pick any confirmed date below. Each game locks at its own tipoff, and each correct pick earns 1 point.</p>
        </div>
        <div className="af-cup-filters" role="group" aria-label="Group Play filter">
          <button type="button" className="af-cup-filter" aria-pressed={filter === "next"} onClick={() => setFilter("next")}>
            {live.length ? `Live (${live.length}) & upcoming` : "Upcoming"}
          </button>
          <button type="button" className="af-cup-filter" aria-pressed={filter === "results"} onClick={() => setFilter("results")}>Results{finals ? ` (${finals})` : ""}</button>
          <button type="button" className="af-cup-filter" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All games</button>
        </div>
      </div>

      <details className="af-cup-walkthrough">
        <summary>How to fill out your NBA Cup bracket</summary>
        <ol>
          <li><strong>Pick Group Play winners.</strong> Use the date shortcuts to pick every available game. You can pick ahead across dates, and each game locks at its own tipoff.</li>
          <li><strong>Finalize each game day.</strong> Pick every open game on that day, then use its Finalize button. Saved edits do not replace your last finalized pick until you finalize again.</li>
          <li><strong>Come back for the knockout rounds.</strong> Quarterfinal picks open after Group Play ends and the NBA confirms the teams and tipoff times.</li>
        </ol>
        <p>Use My Brackets to return to your entry. League owners can use Invite friends to share the league.</p>
      </details>

      {schedule.length > 1 ? (
        <nav className="af-cup-date-nav" aria-label="Jump to a Group Play date">
          <label className="af-cup-date-select">
            <span>Show games by date</span>
            <select value={schedule.some((day) => day.key === selectedDay) ? selectedDay : "all"} onChange={(event) => setSelectedDay(event.target.value)}>
              <option value="all">All dates</option>
              {schedule.map((day) => <option key={day.key} value={day.key}>{day.heading} · {day.list.length} games</option>)}
            </select>
          </label>
          {visibleSchedule.length === schedule.length ? <><strong>Jump to a game date</strong>
          <div>
            {schedule.map((day) => (
              <a key={day.key} href={`#cup-day-${day.key}`}>
                {day.heading}
                {day.openCount ? <small>{day.savedCount}/{day.openCount} saved</small> : null}
              </a>
            ))}
          </div></> : null}
        </nav>
      ) : null}

      {live.length ? (
        <div className="af-cup-live-strip" aria-label="Live games">
          <span className="af-cup-live-label"><span className="af-cup-dot" aria-hidden="true" />LIVE</span>
          {live.map((g) => (
            <button type="button" key={g.id} className="af-cup-live-chip" onClick={() => onOpen(g)} aria-label={`${g.awayTeamName} ${g.liveAwayScore ?? 0}, ${g.homeTeamName} ${g.liveHomeScore ?? 0}, ${cupLiveClock(g)}`}>
              <strong>{cupTeamCode(g.awayTeamName, cupGameDetail(g).awayAbbr)}</strong>{g.liveAwayScore ?? 0}
              <span aria-hidden="true">–</span>
              {g.liveHomeScore ?? 0}<strong>{cupTeamCode(g.homeTeamName, cupGameDetail(g).homeAbbr)}</strong>
              <small>{cupLiveClock(g)}</small>
            </button>
          ))}
        </div>
      ) : null}

      {visibleSchedule.length ? visibleSchedule.map((day, index) => (
        <div className="af-cup-day" key={day.key} id={`cup-day-${day.key}`}>
          <div className="af-cup-day-head">
            <h3>{day.heading}</h3>
            <span>{day.sub}{day.openCount ? ` · ${day.savedCount}/${day.openCount} open picks saved` : ""}</span>
            {canFinalize && day.key !== "tba" && day.openCount > 0 ? (
              <div>
                <span role="status">{day.savedCount < day.openCount ? "Picks missing" : day.pendingCount ? "Saved — not finalized" : "Finalized"}</span>
                {day.pendingCount ? <small>Previously finalized picks still count until you finalize these changes.</small> : null}
                <button type="button" className="af-pb-btn af-pb-btn--accent"
                  disabled={Boolean(savingId || finalizingDay) || day.savedCount < day.openCount || day.pendingCount === 0}
                  onClick={() => onFinalizeDay(day.key)}>
                  {finalizingDay === day.key ? "Finalizing…" : "Finalize this day"}
                </button>
              </div>
            ) : null}
          </div>
          {visibleSchedule[index + 1] ? (
            <a className="af-cup-next-date" href={`#cup-day-${visibleSchedule[index + 1].key}`}>
              Next date: {visibleSchedule[index + 1].heading} →
            </a>
          ) : null}
          <div className="af-cup-grid">
            {day.list.map((game) => (
              <CupGameCard
                key={game.id}
                series={game}
                scoringExcludedReason={scoringExcludedReasonFor?.(game) ?? null}
                sport={sport}
                pick={picks.get(game.id) ?? null}
                teamLogos={teamLogos}
                groupLabel={groupLabel(game)}
                recordOf={recordOf}
                lockedReason={cupGameState(game) === "scheduled" ? lockedReasonFor(game) : null}
                saving={savingId === game.id}
                isDraft={pendingIds.has(game.id)}
                onPick={(team) => onPick(game, team)}
                onOpen={() => onOpen(game)}
              />
            ))}
          </div>
        </div>
      )) : (
        <p className="af-pb-note" role="status" style={{ padding: "0 20px 20px" }}>
          {games.length
            ? filter === "results" ? "No finished games yet. Results land here as games end." : "No upcoming group games. See Results, or the knockout bracket below."
            : "Confirmed Cup games will appear here automatically as the schedule syncs. You can create your bracket now."}
        </p>
      )}
    </section>
  )
}

