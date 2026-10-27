import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { buildProjectedPlayoffSeries } from "@/lib/playoffs/playoffBracketProjection"
import { getPlayoffRoundOrder } from "@/lib/playoffs/playoffTemplate"
import { visiblePlayoffPicks } from "@/lib/playoffs/shareVisibility"
import { readSingleGameSchedule } from "@/lib/playoffs/singleGameSchedule"
import type { PlayoffPickView, PlayoffSeriesView, PlayoffSport } from "@/lib/playoffs/types"
import PlayoffBracketBoard from "@/components/brackets/playoffs/PlayoffBracketBoard"

export const dynamic = "force-dynamic"

export default async function SharedPlayoffEntryPage(props: {
  params: Promise<{ leagueId: string; entryId: string }>
}) {
  const { leagueId, entryId } = await props.params
  const session = await getServerSession(authOptions).catch(() => null)
  const viewerId = String((session?.user as { id?: string } | undefined)?.id ?? "")
  const entry = await (prisma as any).playoffBracketEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true, name: true, challengeId: true,
      challenge: {
        select: { id: true, name: true, sport: true, seasonYear: true, ownerUserId: true, config: true },
      },
    },
  }) as {
    id: string; name: string; challengeId: string
    challenge: { id: string; name: string; sport: string; seasonYear: number; ownerUserId: string; config: unknown }
  } | null

  if (!entry || entry.challengeId !== leagueId || !["ncaaf", "nba_cup"].includes(entry.challenge.sport)) {
    return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-bold">Bracket not found</h1></main>
  }

  const config = entry.challenge.config as { visibility?: string } | null
  const isPublic = config?.visibility === "public"
  const isMember = viewerId && (
    viewerId === entry.challenge.ownerUserId ||
    Boolean(await (prisma as any).playoffBracketEntry.findFirst({
      where: { challengeId: leagueId, userId: viewerId }, select: { id: true },
    }))
  )
  if (!isPublic && !isMember) {
    return <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">Join this league to view shared brackets</h1>
      <p className="mt-3">Ask the commissioner for an invite link or code.</p>
      <Link className="mt-4 inline-block underline" href="/brackets/join">Join a bracket league</Link>
    </main>
  }

  const [rawSeries, rawPicks] = await Promise.all([
    (prisma as any).playoffBracketSeries.findMany({
      where: { challengeId: leagueId }, orderBy: [{ roundIndex: "asc" }, { seriesNumber: "asc" }],
    }),
    (prisma as any).playoffBracketPick.findMany({ where: { entryId } }),
  ])
  const schedule = await readSingleGameSchedule(entry.challenge.sport as "ncaaf" | "nba_cup", entry.challenge.seasonYear)
  const scheduleByNumber = new Map(schedule?.games.map((game) => [game.seriesNumber, game]) ?? [])
  const series = (rawSeries as Array<Record<string, unknown>>).map((row) => ({
    gameLabel: scheduleByNumber.get(Number(row.seriesNumber))?.label || null,
    location: scheduleByNumber.get(Number(row.seriesNumber))?.location || null,
    venue: scheduleByNumber.get(Number(row.seriesNumber))?.venue || row.venue || null,
    ...row,
    startsAt: row.startsAt instanceof Date ? row.startsAt.toISOString() : null,
    nextGameAt: row.nextGameAt instanceof Date ? row.nextGameAt.toISOString() : null,
    lastSyncedAt: row.lastSyncedAt instanceof Date ? row.lastSyncedAt.toISOString() : null,
  })) as PlayoffSeriesView[]
  const visiblePicks = visiblePlayoffPicks(series, rawPicks as PlayoffPickView[])
  const projected = buildProjectedPlayoffSeries(series, visiblePicks)
  const hidden = rawPicks.length - visiblePicks.length

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
    <div className="mx-auto max-w-7xl">
      <Link className="text-sm text-teal-300 underline" href={`/brackets/leagues/${leagueId}`}>Back to league</Link>
      <p className="mt-6 text-xs font-bold uppercase tracking-widest text-teal-300">Shared bracket · Read only</p>
      <h1 className="mt-2 text-3xl font-black">{entry.name}</h1>
      <p className="mt-2 text-slate-300">{entry.challenge.name}</p>
      <p className="my-5 rounded-xl border border-teal-700/50 bg-teal-950/40 p-4 text-sm text-teal-100">
        {hidden > 0 ? `${hidden} picks are hidden until their games begin.` : "All saved picks have been revealed."}
      </p>
      <PlayoffBracketBoard
        rounds={getPlayoffRoundOrder(entry.challenge.sport as PlayoffSport)}
        sport={entry.challenge.sport}
        series={projected}
        picks={visiblePicks}
        locked
        showPickResults
      />
    </div>
  </main>
}
