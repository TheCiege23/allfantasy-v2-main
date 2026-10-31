"use client"

import { useEffect, useRef } from "react"
import type { BracketTeamProfile, PlayoffSeriesView } from "@/lib/playoffs/types"
import { roundLabel, seriesOdds } from "@/lib/playoffs/playoffBracketGraph"
import { isOfficialTeamName } from "@/lib/playoffs/playoffBracketProjection"
import { pointsForSeries } from "@/lib/playoffs/playoffScoring"
import { TeamLogo } from "@/app/components/TeamLogo"

type Props = {
  series: PlayoffSeriesView
  sport: string
  profiles: Record<string, BracketTeamProfile>
  teamLogos: Record<string, string>
  picked: string | null
  locked: boolean
  saving: boolean
  onPick: (team: string) => void
  onClose: () => void
}

function chance(series: PlayoffSeriesView, home?: BracketTeamProfile, away?: BracketTeamProfile) {
  const seeded = seriesOdds(series)
  if (seeded.basis !== "unknown") return { home: seeded.home, away: seeded.away, basis: "Seed comparison" }
  if (home?.winPercentage != null && away?.winPercentage != null) {
    const homeChance = Math.max(20, Math.min(80, Math.round(50 + (home.winPercentage - away.winPercentage) * 0.55)))
    return { home: homeChance, away: 100 - homeChance, basis: "Season record comparison" }
  }
  return null
}

export default function SingleGameMatchupModal({ series, sport, profiles, teamLogos, picked, locked, saving, onPick, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    document.addEventListener("keydown", keydown)
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown) }
  }, [onClose])

  const home = profiles[series.homeTeamName]
  const away = profiles[series.awayTeamName]
  const estimate = chance(series, home, away)
  const hasTeams = isOfficialTeamName(series.homeTeamName) && isOfficialTeamName(series.awayTeamName)
  const choice = estimate ? estimate.home >= estimate.away ? series.homeTeamName : series.awayTeamName : null
  const canPick = hasTeams && !locked && !saving
  const dateLabel = series.startsAt && Number.isFinite(Date.parse(series.startsAt))
    ? new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(series.startsAt))
    : "Start time to be announced"

  const teamCard = (name: string, seed: number, profile: BracketTeamProfile | undefined, probability: number | null) => (
    <div className={`rounded-3xl border p-5 sm:p-7 ${picked === name ? "border-teal-300 bg-teal-400/10" : "border-white/15 bg-white/5"}`}>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-300">{seed > 0 ? `Seed ${seed}` : "Tournament team"}</p>
      <div className="mt-3 flex items-center gap-4">
        {isOfficialTeamName(name) && !/^(?:CFP|EAST|WEST)\d+$/i.test(name) ? (
          <TeamLogo teamAbbr={name} sport={sport === "ncaaf" ? "NCAAF" : "NBA_CUP"} logoUrl={teamLogos[name] ?? null} size={64} className="border-white/20 bg-white/10" />
        ) : null}
        <h2 className="text-2xl font-black sm:text-4xl">{isOfficialTeamName(name) ? name : "Winner to be determined"}</h2>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-900/80 p-3"><strong className="block text-xl">{profile?.won != null && profile.lost != null ? `${profile.won}-${profile.lost}` : "—"}</strong><span className="text-xs text-slate-400">Record</span></div>
        <div className="rounded-xl bg-slate-900/80 p-3"><strong className="block text-xl">{profile?.winPercentage != null ? `${profile.winPercentage}%` : "—"}</strong><span className="text-xs text-slate-400">Win rate</span></div>
        <div className="rounded-xl bg-slate-900/80 p-3"><strong className="block text-xl">{profile?.plusMinus != null ? `${profile.plusMinus >= 0 ? "+" : ""}${profile.plusMinus}` : "—"}</strong><span className="text-xs text-slate-400">+/−</span></div>
      </div>
      <p className="mt-4 min-h-10 text-sm text-slate-300">{profile?.seasonReview ?? "Season review will appear when verified standings are available."}</p>
      <button type="button" disabled={!canPick} onClick={() => onPick(name)}
        className="mt-5 w-full rounded-xl border border-teal-300 bg-teal-300 px-4 py-3 font-bold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-40">
        {picked === name ? "Your pick · change to this team" : `Pick ${name}`}
      </button>
      {probability != null && <p className="mt-2 text-center text-xs text-slate-400">{probability}% matchup estimate</p>}
    </div>
  )

  return <div className="fixed inset-0 z-[1000] overflow-y-auto bg-slate-950 text-white" role="dialog" aria-modal="true" aria-label={`${series.homeTeamName} versus ${series.awayTeamName} matchup`}>
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <button ref={closeRef} type="button" onClick={onClose} className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10">← Back to bracket</button>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-teal-300 px-3 py-1 text-xs font-black uppercase tracking-wider text-slate-950">{roundLabel(sport, series.round)}</span>
        <span className="text-sm font-bold text-amber-200">+{pointsForSeries(series, sport)} points</span>
        {locked && <span className="rounded-full border border-amber-300/40 px-3 py-1 text-xs text-amber-200">Picks locked</span>}
      </div>
      <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">{series.gameLabel || (sport === "ncaaf" && series.roundIndex > 1 && series.roundIndex < 4 ? "Bowl assignment to be announced" : "Tournament matchup")}</h1>
      <p className="mt-3 text-slate-300">{dateLabel} · {series.venue || "Venue to be announced"}{series.location ? ` · ${series.location}` : ""}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {teamCard(series.homeTeamName, series.homeSeed, home, estimate?.home ?? null)}
        {teamCard(series.awayTeamName, series.awaySeed, away, estimate?.away ?? null)}
      </div>
      <section className="mt-5 rounded-3xl border border-violet-300/25 bg-violet-400/10 p-5 sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-200">Chimmy Intelligence</p>
        <h2 className="mt-2 text-xl font-bold">A smart read before you pick</h2>
        {estimate ? <>
          <div className="mt-5 flex justify-between text-sm font-bold"><span>{series.homeTeamName} {estimate.home}%</span><span>{series.awayTeamName} {estimate.away}%</span></div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-slate-700"><span className="bg-teal-300" style={{ width: `${estimate.home}%` }} /><span className="bg-violet-400" style={{ width: `${estimate.away}%` }} /></div>
          <p className="mt-3 text-sm text-slate-300">Basis: {estimate.basis}. This is a transparent comparison, not a guaranteed outcome. Verified records and point differential appear above when available.</p>
          <button type="button" disabled={!canPick || !choice} onClick={() => choice && onPick(choice)}
            className="mt-5 rounded-xl bg-violet-300 px-5 py-3 font-black text-slate-950 hover:bg-violet-200 disabled:opacity-40">
            Go with Chimmy&apos;s Choice · {choice}
          </button>
        </> : <p className="mt-4 text-sm text-slate-300">No trustworthy estimate is available for this matchup yet. Pick either team after the official field is set.</p>}
      </section>
      <p className="mt-6 text-xs text-slate-400">AllFantasy brackets are for fun and competition. No entry fees, prizes, betting, or payouts are offered here.</p>
    </div>
  </div>
}
