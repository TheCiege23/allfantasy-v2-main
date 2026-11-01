"use client"

import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { bracketCompanionCopy } from "@/lib/brackets/bracketCompanionCopy"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import { TeamLogo } from "@/app/components/TeamLogo"
import { getPlayoffPickResult, pointsForSeries } from "@/lib/playoffs/playoffScoring"
import { cupGameDetail, cupGameProgress, cupGameState, cupLiveClock, cupTeamCode } from "@/lib/playoffs/nbaCupBoard"
import { countdown, timeOnly, tipoffLabel } from "./cupFormat"

export type CupGameCardProps = {
  scoringExcludedReason?: "draft" | "late" | null
  series: PlayoffSeriesView
  sport: string
  pick: string | null
  teamLogos: Record<string, string>
  groupLabel: string | null
  /** Group-play record for a team, e.g. "2-1", or null when unknown. */
  recordOf: (team: string) => string | null
  lockedReason: string | null
  saving: boolean
  onPick: (team: string) => void
  onOpen: () => void
}

/**
 * One Group Play game in whichever of its three states it is in:
 * scheduled (date, tipoff, pick buttons), live (clock, score, leaders, how
 * your pick is doing) or final (score, top scorer per team, group records).
 *
 * Away is listed above home, the order a scoreboard reads.
 */
export default function CupGameCard({ series, sport, pick, teamLogos, groupLabel, recordOf, lockedReason, saving, onPick, onOpen, scoringExcludedReason }: CupGameCardProps) {
  const { language } = useOptionalLanguage(), copy = bracketCompanionCopy(language)
  const state = cupGameState(series)
  const detail = cupGameDetail(series)
  const points = pointsForSeries(series, sport)
  const sides = [
    { name: series.awayTeamName, score: series.liveAwayScore ?? null, leader: detail.awayLeader, abbr: detail.awayAbbr },
    { name: series.homeTeamName, score: series.liveHomeScore ?? null, leader: detail.homeLeader, abbr: detail.homeAbbr },
  ]
  const leading = state !== "scheduled" && sides[0].score != null && sides[1].score != null && sides[0].score !== sides[1].score
    ? (sides[0].score > sides[1].score ? sides[0].name : sides[1].name)
    : null
  const winner = series.winnerTeamName ?? null

  let tone: "good" | "bad" | "live" | undefined
  let result: string
  if (state === "final") {
    const r = getPlayoffPickResult(series, pick ? { pickTeamName: pick } : null, sport)
    tone = r.status === "correct" ? "good" : r.status === "wrong" ? "bad" : undefined
    result = r.status === "correct" ? `Your pick was right · +${r.points}` : r.status === "wrong" ? "Your pick missed · 0" : "No pick on this game"
  } else if (state === "live") {
    if (!pick) result = "No pick · locked at tipoff"
    else {
      const mine = sides.find((s) => s.name === pick)
      const theirs = sides.find((s) => s.name !== pick)
      const margin = mine?.score != null && theirs?.score != null ? mine.score - theirs.score : null
      if (margin == null || margin === 0) { result = "Your pick is tied"; tone = "live" }
      else if (margin > 0) { result = `Your pick leads by ${margin} · +${points} if it holds`; tone = "live" }
      else { result = `Your pick trails by ${-margin}`; tone = "bad" }
    }
  } else {
    const left = countdown(series.startsAt)
    result = lockedReason
      ? lockedReason
      : pick
        ? `Picked ${cupTeamCode(pick)} · locks at tipoff${left ? ` ${left}` : ""}`
        : `Choose your winner · locks at tipoff${left ? ` ${left}` : ""}`
    if (pick && !lockedReason) tone = "good"
  }

  if (pick && scoringExcludedReason && state !== "scheduled") {
    result = state === "final" ? `${copy.reasons[scoringExcludedReason]} · 0` : `${result.replace(/ · \+\d+ if it holds$/, "")} · ${copy.reasons[scoringExcludedReason]}`
    tone = undefined
  }

  const stage = groupLabel ? `Group Play · ${groupLabel}` : series.gameLabel?.replace(/^NBA Cup\s*-?\s*/i, "") || "Group Play"
  const when = tipoffLabel(series.startsAt)
  const venue = [series.venue, series.location].filter(Boolean).join(" · ")
  const groupLine = state === "final" && winner
    ? `Group now: ${sides.map((s) => `${cupTeamCode(s.name, s.abbr)} ${recordOf(s.name) ?? "—"}`).join(" · ")}`
    : null

  return (
    <article className="af-cup-card" data-state={state} id={`playoff-series-${series.id}`} data-testid={`cup-game-${series.seriesNumber}`}>
      <div className="af-cup-card-top">
        <span className="af-cup-stage">{stage}</span>
        {state === "live" ? (
          <span className="af-cup-chip af-cup-chip--live"><span className="af-cup-dot" aria-hidden="true" />LIVE · {cupLiveClock(series)}</span>
        ) : state === "final" ? (
          <span className="af-cup-chip af-cup-chip--final">{detail.detail && /^final\//i.test(detail.detail) ? detail.detail.toUpperCase() : "FINAL"}</span>
        ) : (
          <span className="af-cup-chip af-cup-chip--time">{timeOnly(series.startsAt) ?? "Time TBA"}</span>
        )}
      </div>
      {state === "live" ? <div className="af-cup-progress" aria-hidden="true"><span style={{ width: `${cupGameProgress(series)}%` }} /></div> : null}

      <div className="af-cup-rows">
        {sides.map((side) => {
          const dim = (state === "final" && winner != null && winner !== side.name) || (state === "live" && leading != null && leading !== side.name)
          const record = recordOf(side.name)
          const sub = state === "scheduled"
            ? record ? `${record} in group play` : "Group play"
            : side.leader ? `${state === "final" ? "Top scorer · " : ""}${side.leader.name} ${side.leader.points} PTS` : record ? `${record} in group play` : ""
          return (
            <div className="af-cup-row" key={side.name} data-dim={dim ? "true" : undefined}>
              <TeamLogo teamAbbr={side.name} sport="NBA_CUP" logoUrl={teamLogos[side.name] ?? null} size={34} />
              <div className="af-cup-row-text">
                <span className="af-cup-row-name">{side.name}</span>
                {sub || (pick === side.name && state !== "scheduled") ? (
                  <span className="af-cup-row-sub">
                    {pick === side.name && state !== "scheduled" ? <span className="af-cup-mine">Your pick</span> : null}
                    {sub}
                  </span>
                ) : null}
              </div>
              {state === "scheduled" ? (
                <button
                  type="button"
                  className="af-cup-pick"
                  aria-pressed={pick === side.name}
                  disabled={Boolean(lockedReason) || saving}
                  onClick={() => onPick(side.name)}
                  aria-label={pick === side.name ? `${side.name} is your pick` : `Pick ${side.name}`}
                >
                  {saving && pick !== side.name ? "…" : pick === side.name ? "Picked" : "Pick"}
                </button>
              ) : (
                <span className="af-cup-score">{side.score ?? "–"}</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="af-cup-card-foot">
        <span className="af-cup-meta">{state === "scheduled" ? when ?? "Tipoff to be announced" : when ? when.split(" · ")[0] : ""}{venue ? `${state === "scheduled" || when ? " · " : ""}${venue}` : ""}</span>
        <span className="af-cup-result" data-tone={tone}>{result}</span>
        {groupLine ? <span className="af-cup-group-line">{groupLine}</span> : null}
        <button type="button" className="af-cup-details" onClick={onOpen}>
          {state === "scheduled" ? "Matchup details & Chimmy read →" : state === "live" ? "Live game details →" : "Box score & recap →"}
        </button>
      </div>
    </article>
  )
}
