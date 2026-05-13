"use client"

import type { PlayoffPickView, PlayoffRoundKey, PlayoffSeriesView } from "@/lib/playoffs/types"

type Props = {
  rounds: PlayoffRoundKey[]
  series: PlayoffSeriesView[]
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked?: boolean
}

const ROUND_LABELS: Record<PlayoffRoundKey, string> = {
  round_1: "Round 1",
  conference_semifinals: "Conf. Semis",
  conference_finals: "Conf. Finals",
  finals: "Finals",
}

function getPickForSeries(picks: PlayoffPickView[], seriesId: string): PlayoffPickView | null {
  return picks.find((pick) => pick.seriesId === seriesId) ?? null
}

function SeriesStatusBadge({ status, winnerTeamName }: { status: string; winnerTeamName: string | null }) {
  if (status === "final" && winnerTeamName) {
    return (
      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-800">
        Final
      </span>
    )
  }
  if (status === "in_progress") {
    return (
      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800">
        Live
      </span>
    )
  }
  return null
}

export default function PlayoffBracketBoard({ rounds, series, picks, onPick, locked = false }: Props) {
  return (
    <div className="relative overflow-x-auto rounded-3xl border border-slate-300/80 bg-[linear-gradient(180deg,#fdfcf8_0%,#f4f7ff_100%)] p-3 shadow-[0_18px_48px_rgba(15,23,42,0.12)] sm:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(251,191,36,0.18),transparent_40%),radial-gradient(circle_at_90%_15%,rgba(14,165,233,0.2),transparent_35%)]" />

      {/* Mobile: stacked rounds — Desktop: side-by-side grid */}
      <div className="relative flex flex-col gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {rounds.map((roundKey) => {
          const roundSeries = series.filter((item) => item.round === roundKey)
          return (
            <section key={roundKey} className="rounded-2xl border border-slate-300/70 bg-white/80 p-3 backdrop-blur-sm">
              <header className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                <h3 className="text-sm font-semibold tracking-wide text-slate-800">{ROUND_LABELS[roundKey]}</h3>
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                  {roundSeries.length}
                </span>
              </header>
              <div className="space-y-3">
                {roundSeries.map((item) => {
                  const pick = getPickForSeries(picks, item.id)
                  const isFinal = item.status === "final"
                  const isLive = item.status === "in_progress"
                  const teams = [
                    { name: item.homeTeamName, wins: item.homeWins, seed: item.homeSeed },
                    { name: item.awayTeamName, wins: item.awayWins, seed: item.awaySeed },
                  ]
                  return (
                    <article
                      key={item.id}
                      data-series-id={item.id}
                      className={`rounded-xl border p-3 shadow-sm ${isLive ? "border-amber-300 bg-amber-50/50" : "border-slate-200 bg-white"}`}
                    >
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <span>S{item.seriesNumber}</span>
                        <div className="flex items-center gap-1">
                          <SeriesStatusBadge status={item.status} winnerTeamName={item.winnerTeamName} />
                          <span className="text-slate-400">Bo{item.bestOf}</span>
                        </div>
                      </div>

                      {/* Series score (live or final) */}
                      {(isLive || isFinal) && (
                        <div className="mb-2 flex items-center justify-center gap-1 text-xs font-black text-slate-700">
                          <span>{item.homeWins}</span>
                          <span className="text-slate-400">–</span>
                          <span>{item.awayWins}</span>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        {teams.map(({ name: teamName, wins, seed }) => {
                          const selected = pick?.pickTeamName === teamName
                          const isPickCorrect = pick?.isCorrect === true && pick.pickTeamName === teamName
                          const isPickWrong = pick?.isCorrect === false && pick.pickTeamName === teamName
                          const isWinner = isFinal && item.winnerTeamName === teamName
                          return (
                            <button
                              key={`${item.id}:${teamName}`}
                              type="button"
                              disabled={locked || isFinal}
                              onClick={() => onPick?.(item.id, teamName)}
                              className={`relative w-full rounded-lg border px-2.5 py-2 text-left text-sm font-semibold transition ${
                                isPickCorrect
                                  ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                                  : isPickWrong
                                    ? "border-rose-300 bg-rose-50 text-rose-700 line-through"
                                    : isWinner && !selected
                                      ? "border-emerald-300 bg-emerald-50/60 text-slate-700"
                                      : selected
                                        ? "border-amber-500 bg-amber-100 text-amber-900"
                                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-400 hover:bg-sky-50"
                              } ${locked || isFinal ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                            >
                              <span className="flex items-center justify-between gap-1">
                                <span className="truncate">
                                  <span className="mr-1 text-[10px] font-normal text-slate-400">#{seed}</span>
                                  {teamName}
                                </span>
                                {(isLive || isFinal) && (
                                  <span className={`shrink-0 text-xs font-black ${isWinner ? "text-emerald-700" : "text-slate-500"}`}>
                                    {wins}
                                  </span>
                                )}
                              </span>
                            </button>
                          )
                        })}
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                        <span>{item.conference === "finals" ? "Finals" : `${item.conference.charAt(0).toUpperCase() + item.conference.slice(1)}`}</span>
                        {item.startsAt && !isFinal && !isLive && (
                          <span>{new Date(item.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                        )}
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
