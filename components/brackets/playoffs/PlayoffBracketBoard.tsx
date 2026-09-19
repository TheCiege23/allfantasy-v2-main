"use client"

import type { PlayoffPickView, PlayoffRoundKey, PlayoffSeriesView } from "@/lib/playoffs/types"
import {
  isPlayoffSeriesResolved,
  PLAYOFF_OFFICIAL_MATCHUP_TBD_MESSAGE,
  PLAYOFF_UNRESOLVED_SERIES_MESSAGE,
} from "@/lib/playoffs/playoffBracketProjection"
import { canUsePlayoffLatePicks, getPlayoffSeriesLockedReason } from "@/lib/playoffs/playoffLocking"
import { getPlayoffPickResult } from "@/lib/playoffs/playoffScoring"

type Props = {
  rounds: PlayoffRoundKey[]
  series: PlayoffSeriesView[]
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked?: boolean
  savingSeriesIds?: Set<string>
  savedSeriesIds?: Set<string>
  nextSeriesId?: string | null
  showPickResults?: boolean
  officialBracketMode?: boolean
  projectionMode?: "official" | "user_projection"
  lockRule?: string | null
  canUseLatePicks?: boolean
  showLockDiagnostics?: boolean
  lockDiagnostics?: {
    allowTestLatePicks: boolean
    viewerCanLatePick: boolean
  } | null
}

const ROUND_LABELS: Record<PlayoffRoundKey, string> = {
  round_1: "Round 1",
  conference_semifinals: "Conference Semis",
  conference_finals: "Conference Finals",
  finals: "Finals",
  wild_card: "Wild Card",
  division_series: "Division Series",
  league_championship: "Championship Series",
  world_series: "World Series",
}

/**
 * ⚠ RESOLVED FROM THE ROUND, NOT FROM A `sport` PROP. A series only knows which
 * half of the draw it sits in; `finals` is the half both halves feed, and what
 * that final is CALLED differs by sport. Reading it off the round keeps this a
 * pure function of the row and means no caller has to remember to thread a
 * sport down — the case that would otherwise silently render "Cup Finals" over
 * a World Series.
 */
function conferenceLabel(series: PlayoffSeriesView): string {
  if (series.conference === "al") return "American League"
  if (series.conference === "nl") return "National League"
  if (series.conference === "finals") {
    return series.round === "world_series" ? "World Series" : "Cup Finals"
  }
  return `${series.conference.toUpperCase()} Conference`
}

function getPickForSeries(picks: PlayoffPickView[], seriesId: string): PlayoffPickView | null {
  return picks.find((pick) => pick.seriesId === seriesId) ?? null
}

function normalizedPickName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function containsWholeTeamName(value: string, target: string): boolean {
  if (!value || !target) return false
  return new RegExp(`(^| )${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(value)
}

function pickMatchesTeam(pickTeamName: string | null | undefined, teamName: string): boolean {
  const pick = normalizedPickName(pickTeamName)
  const team = normalizedPickName(teamName)
  if (!pick || !team) return false
  return pick === team || containsWholeTeamName(pick, team) || containsWholeTeamName(team, pick)
}

function formatGameTime(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function formatGameDateOnly(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  const normalized = /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : raw
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date)
}

function providerNextGameDateLabel(item: PlayoffSeriesView): string | null {
  if (item.nextGameDateLabel) return item.nextGameDateLabel
  const games = Array.isArray(item.providerGamesJson) ? item.providerGamesJson : []
  const now = Date.now()
  const nextGame = games
    .filter((game): game is Record<string, unknown> => !!game && typeof game === "object" && !Array.isArray(game))
    .map((game) => String(game.startTime ?? ""))
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = Date.parse(/^\d{8}$/.test(a) ? `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}T00:00:00.000Z` : a)
      const bTime = Date.parse(/^\d{8}$/.test(b) ? `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}T00:00:00.000Z` : b)
      const safeA = Number.isFinite(aTime) ? aTime : Number.MAX_SAFE_INTEGER
      const safeB = Number.isFinite(bTime) ? bTime : Number.MAX_SAFE_INTEGER
      return safeA - safeB
    })
    .find((startTime) => {
      const time = Date.parse(/^\d{8}$/.test(startTime) ? `${startTime.slice(0, 4)}-${startTime.slice(4, 6)}-${startTime.slice(6, 8)}T00:00:00.000Z` : startTime)
      return !Number.isFinite(time) || time >= now || Boolean(formatGameDateOnly(startTime))
    })
  return formatGameDateOnly(nextGame)
}

function isFinalStatus(value: string | null | undefined): boolean {
  return /\bfinal\b/i.test(String(value ?? ""))
}

function latestFinalGame(item: PlayoffSeriesView): { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null } | null {
  const games = Array.isArray(item.providerGamesJson) ? item.providerGamesJson : []
  const finalGame = games
    .filter((game): game is Record<string, unknown> => !!game && typeof game === "object" && !Array.isArray(game))
    .filter((game) => isFinalStatus(`${String(game.status ?? "")} ${String(game.statusDetail ?? "")}`))
    .sort((a, b) => new Date(String(b.startTime ?? "")).getTime() - new Date(String(a.startTime ?? "")).getTime())[0]
  if (!finalGame) return null
  return {
    homeTeam: String(finalGame.homeTeam ?? item.homeTeamName),
    awayTeam: String(finalGame.awayTeam ?? item.awayTeamName),
    homeScore: typeof finalGame.homeScore === "number" ? finalGame.homeScore : null,
    awayScore: typeof finalGame.awayScore === "number" ? finalGame.awayScore : null,
  }
}

function getSeriesCardBorderClass(showPickResults: boolean, status: ReturnType<typeof getPlayoffPickResult>["status"], isNext: boolean): string {
  if (!showPickResults) {
    return isNext ? "border-sky-400" : "border-slate-200"
  }
  if (status === "correct") {
    return "border-2 border-cyan-400 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]"
  }
  if (status === "wrong") {
    return "border-2 border-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.25)]"
  }
  return "border-2 border-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.3)]"
}

export default function PlayoffBracketBoard({
  rounds,
  series,
  picks,
  onPick,
  locked = false,
  savingSeriesIds,
  savedSeriesIds,
  nextSeriesId,
  showPickResults = false,
  officialBracketMode = false,
  projectionMode = officialBracketMode ? "official" : "user_projection",
  lockRule = null,
  canUseLatePicks = false,
  showLockDiagnostics = false,
  lockDiagnostics = null,
}: Props) {
  const latePicksEnabled = canUsePlayoffLatePicks({ lockRule, hasPoolAdminAccess: canUseLatePicks })
  return (
    <div className="relative overflow-x-auto rounded-3xl border border-slate-300/80 bg-[linear-gradient(180deg,#fdfcf8_0%,#f4f7ff_100%)] p-4 shadow-[0_18px_48px_rgba(15,23,42,0.12)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(251,191,36,0.18),transparent_40%),radial-gradient(circle_at_90%_15%,rgba(14,165,233,0.2),transparent_35%)]" />
      <div className="relative grid min-w-[980px] grid-cols-4 gap-4">
        {rounds.map((roundKey) => {
          const roundSeries = series.filter((item) => item.round === roundKey)
          return (
            <section key={roundKey} className="rounded-2xl border border-slate-300/70 bg-white/80 p-3 backdrop-blur-sm">
              <header className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                <h3 className="font-semibold tracking-wide text-slate-800">{ROUND_LABELS[roundKey]}</h3>
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                  {roundSeries.length} series
                </span>
              </header>
              <div className="space-y-3">
                {roundSeries.map((item) => {
                  const pick = getPickForSeries(picks, item.id)
                  const unresolved = !isPlayoffSeriesResolved(item)
                  const unresolvedMessage = officialBracketMode ? PLAYOFF_OFFICIAL_MATCHUP_TBD_MESSAGE : PLAYOFF_UNRESOLVED_SERIES_MESSAGE
                  const lockedReason = locked ? "Series already started/locked" : getPlayoffSeriesLockedReason(item, lockRule, { hasPoolAdminAccess: canUseLatePicks })
                  const isSaving = savingSeriesIds?.has(item.id) ?? false
                  const isSaved = savedSeriesIds?.has(item.id) ?? false
                  const isNext = nextSeriesId === item.id
                  const pickResult = getPlayoffPickResult(item, pick)
                  const seriesCardBorderClass = getSeriesCardBorderClass(showPickResults, pickResult.status, isNext)
                  const advancedFrom = item.sourceSeriesHome || item.sourceSeriesAway
                    ? projectionMode === "user_projection"
                      ? pick ? "user_pick" : "unresolved"
                      : item.winnerTeamName ? "official_winner" : "unresolved"
                    : "unresolved"
                  const finalGame = latestFinalGame(item)
                  const nextGameLabel = formatGameTime(item.nextGameAt) ?? providerNextGameDateLabel(item) ?? "TBD"
                  return (
                    <article
                      key={item.id}
                      id={`playoff-series-${item.id}`}
                      data-testid={`playoff-series-${item.id}`}
                      className={`rounded-xl border bg-white p-3 shadow-sm ${seriesCardBorderClass}`}
                    >
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <span>S{item.seriesNumber}</span>
                        <span>
                          {isSaving ? "Saving..." : isSaved ? "Saved" : item.bestOf === 7 ? "Best of 7" : `Best of ${item.bestOf}`}
                        </span>
                      </div>
                      {unresolved ? (
                        <p
                          data-testid={`playoff-series-disabled-reason-${item.id}`}
                          className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"
                        >
                          {unresolvedMessage}
                        </p>
                      ) : null}
                      {!unresolved && lockedReason ? (
                        <p
                          data-testid={`playoff-series-disabled-reason-${item.id}`}
                          className="mb-2 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                        >
                          {lockedReason}
                        </p>
                      ) : null}
                      {!unresolved && latePicksEnabled ? (
                        <p
                          data-testid={`playoff-series-late-picks-${item.id}`}
                          className="mb-2 rounded-lg border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800"
                        >
                          Late/test picks enabled.
                        </p>
                      ) : null}
                      {showLockDiagnostics ? (
                        <div
                          data-testid={`playoff-series-lock-diagnostics-${item.id}`}
                          className="mb-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500"
                        >
                          lockRule={String(lockRule ?? "series_start")}; allowTestLatePicks={String(lockDiagnostics?.allowTestLatePicks ?? false)}; viewerCanLatePick={String(lockDiagnostics?.viewerCanLatePick ?? latePicksEnabled)}; reason={lockedReason ?? "unlocked"}
                          <br />
                          savedPickTeamName={pick?.pickTeamName ?? "none"}; winnerTeamName={item.winnerTeamName ?? "none"}; projectionMode={projectionMode}; advancedFrom={advancedFrom}
                        </div>
                      ) : null}
                      <div className="space-y-2">
                        {[item.homeTeamName, item.awayTeamName].map((teamName) => {
                          const selected = pickMatchesTeam(pick?.pickTeamName, teamName)
                          const disabled = Boolean(lockedReason) || unresolved || isSaving
                          return (
                            <button
                              key={`${item.id}:${teamName}`}
                              type="button"
                              disabled={disabled}
                              title={lockedReason ?? (unresolved ? unresolvedMessage : isSaving ? "This pick is saving" : undefined)}
                              onClick={() => disabled ? undefined : onPick?.(item.id, teamName)}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                                selected
                                  ? "border-amber-500 bg-amber-100 text-amber-900"
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-400 hover:bg-sky-50"
                              } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                            >
                              {teamName}
                            </button>
                          )
                        })}
                      </div>
                      <div className="mt-2 space-y-1 rounded-lg bg-slate-50 px-2 py-2 text-xs font-semibold text-slate-600">
                        <p data-testid={`playoff-series-summary-${item.id}`}>
                          {item.seriesSummary || "Series starts TBD"}
                        </p>
                        {item.liveStatus ? (
                          <p data-testid={`playoff-series-live-${item.id}`} className="text-emerald-700">
                            Live: {item.homeTeamName} {item.liveHomeScore ?? "-"}, {item.awayTeamName} {item.liveAwayScore ?? "-"} — {item.liveStatus}
                          </p>
                        ) : null}
                        {!item.liveStatus && finalGame ? (
                          <p data-testid={`playoff-series-final-${item.id}`} className="text-slate-700">
                            Final: {finalGame.homeTeam} {finalGame.homeScore ?? "-"}, {finalGame.awayTeam} {finalGame.awayScore ?? "-"}
                          </p>
                        ) : null}
                        <p data-testid={`playoff-series-next-${item.id}`}>
                          Next: {nextGameLabel} — {item.broadcastNetwork || "TBD"}
                        </p>
                        <p data-testid={`playoff-series-venue-${item.id}`}>
                          {item.venue ? `At ${item.venue}` : "Venue TBD"}
                        </p>
                      </div>
                      {showPickResults ? (
                        <div
                          className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
                          data-testid={`playoff-series-pick-result-${item.id}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>Your pick: {pickResult.pickTeamName ?? "No Pick"}</span>
                            <span
                              className={
                                pickResult.status === "correct"
                                  ? "text-emerald-700"
                                  : pickResult.status === "wrong"
                                    ? "text-rose-700"
                                    : "text-slate-500"
                              }
                            >
                              {pickResult.status === "correct"
                                ? `Correct +${pickResult.points}`
                                : pickResult.status === "wrong"
                                  ? `Wrong +${pickResult.points}`
                                  : pickResult.status === "pending"
                                    ? "Pending"
                                    : "No Pick"}
                            </span>
                          </div>
                          <p className="text-slate-500">
                            Result: {pickResult.seriesSummary ?? (pickResult.winnerTeamName ? `${pickResult.winnerTeamName} wins` : "Result pending")}
                          </p>
                        </div>
                      ) : null}
                      <div className="mt-2 text-xs text-slate-500">
                        {conferenceLabel(item)}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
