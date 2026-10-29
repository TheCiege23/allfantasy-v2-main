import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { championshipTotal, rankBrackets, scoreAndPotential } from "@/lib/playoffs/playoffCompetition"
import type { PlayoffSport } from "@/lib/playoffs/types"

export const dynamic = "force-dynamic"

export default async function UniversalBracketStandings(props: {
  searchParams: Promise<{ sport?: string; season?: string }>
}) {
  const params = await props.searchParams
  const sport: PlayoffSport = params.sport === "nba_cup" ? "nba_cup" : "ncaaf"
  const parsedSeason = Number(params.season)
  const season = Number.isInteger(parsedSeason) && parsedSeason >= 2024 && parsedSeason <= 2100
    ? parsedSeason : new Date().getUTCFullYear()
  const entries = await (prisma as any).playoffBracketEntry.findMany({
    where: { finalizedAt: { not: null }, challenge: { sport, seasonYear: season, isTestMode: false } },
    select: {
      id: true, name: true, tiebreakerTotalScore: true,
      user: { select: { displayName: true, username: true } },
      picks: { select: { seriesId: true, pickTeamName: true } },
      challenge: {
        select: { id: true, name: true, config: true, series: {
          select: { id: true, round: true, winnerTeamName: true, homeTeamName: true,
            awayTeamName: true, liveHomeScore: true, liveAwayScore: true },
        } },
      },
    },
  }) as Array<{
    id: string; name: string; tiebreakerTotalScore: number | null
    user: { displayName: string | null; username: string | null }
    picks: Array<{ seriesId: string; pickTeamName: string }>
    challenge: { id: string; name: string; config: { visibility?: string } | null; series: any[] }
  }>
  const completedFinal = entries.map((entry) => championshipTotal(entry.challenge.series)).find((total) => total != null) ?? null
  const scored = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    userName: entry.user?.displayName?.trim() || entry.user?.username?.trim() || "Participant",
    leagueId: entry.challenge.id,
    leagueName: entry.challenge.config?.visibility === "public" ? entry.challenge.name : "Private league",
    tiebreakerTotalScore: entry.tiebreakerTotalScore,
    ...scoreAndPotential(entry.challenge.series, entry.picks, sport),
  }))
  const ranked = rankBrackets(scored, completedFinal)
  const title = sport === "ncaaf" ? "College Football Playoff" : "NBA Cup"

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6">
    <div className="mx-auto max-w-6xl">
      <Link href="/brackets" className="text-sm font-semibold text-teal-300">← Brackets</Link>
      <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-300">AllFantasy universal board</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">{title} · {season}</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-300">Every finalized bracket across AllFantasy leagues. Earned points, possible points, and the same tiebreaker rules for everyone.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/brackets/standings?sport=ncaaf&season=${season}`} className={`rounded-xl border px-4 py-2 text-sm font-bold ${sport === "ncaaf" ? "border-teal-300 bg-teal-300 text-slate-950" : "border-white/20 text-white"}`}>CFP</Link>
          <Link href={`/brackets/standings?sport=nba_cup&season=${season}`} className={`rounded-xl border px-4 py-2 text-sm font-bold ${sport === "nba_cup" ? "border-teal-300 bg-teal-300 text-slate-950" : "border-white/20 text-white"}`}>NBA Cup</Link>
        </div>
      </div>
      <div className="mt-8 overflow-x-auto rounded-3xl border border-white/15 bg-slate-900/80 shadow-2xl">
        <table className="w-full min-w-[680px] text-left">
          <thead className="border-b border-white/15 text-xs uppercase tracking-wider text-slate-400"><tr>
            <th className="px-5 py-4">Rank</th><th className="px-5 py-4">Bracket</th><th className="px-5 py-4">League</th>
            <th className="px-5 py-4 text-right">Points</th><th className="px-5 py-4 text-right">Potential</th><th className="px-5 py-4 text-right">Correct</th>
          </tr></thead>
          <tbody>
            {ranked.map((entry) => <tr key={entry.id} className="border-b border-white/10 last:border-b-0 hover:bg-white/5">
              <td className="px-5 py-4 font-black text-teal-300">#{entry.rank}</td>
              <td className="px-5 py-4"><span className="block font-bold">{entry.name}</span><span className="text-xs text-slate-400">{entry.userName}</span></td>
              <td className="px-5 py-4 text-sm text-slate-300">{entry.leagueName}</td>
              <td className="px-5 py-4 text-right font-black">{entry.totalScore}</td>
              <td className="px-5 py-4 text-right font-bold text-amber-200">{entry.potentialTotal}</td>
              <td className="px-5 py-4 text-right text-slate-300">{entry.correctPicks}</td>
            </tr>)}
          </tbody>
        </table>
        {ranked.length === 0 && <p className="p-8 text-center text-slate-300">No finalized brackets yet. Make your picks before the first game and claim the first spot.</p>}
      </div>
      <p className="mt-4 text-sm text-slate-400">Ties: more points, then closest predicted final-game combined score once final, then more correct picks. Equal brackets share a rank. Potential does not break ties.</p>
      <p className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm font-semibold text-amber-100">No prizes, gambling, betting, entry fees, or payouts are offered by AllFantasy. Paid subscriptions only provide extra bracket capacity.</p>
    </div>
  </main>
}
