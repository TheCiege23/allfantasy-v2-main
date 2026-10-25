import 'server-only'

import { leagueCall } from '@/lib/core-app/leagueCall'
import type { MoveTone } from '@/lib/core-app/playerMoves'
import { prisma } from '@/lib/prisma'
import type { StatusBucket } from './playerNewsStatus'
import { lineupImpactKind, type LeagueLineupImpact } from './lineupImpactCopy'

/**
 * Does this injury or status change affect the person's starting lineup, and what should they do?
 * The rules and the copy are in ./lineupImpactCopy.ts; this module does the reading.
 *
 * NFL with a Sleeper id: the Player Finder's league-scored picker (`getPlayerImpact` + `leagueCall`)
 * decides starting / bench, the backup to start, and whether a healthy bench player out-projects a
 * starter. A ruled-out starter with nobody on the bench gets the fan-out's free-agent pick (AF Pro
 * player depth only, as on the card).
 *
 * Anything else (another sport, no Sleeper id, the picker failing or running long): `startingLeagueIds`
 * — the leagues where the roster has him in a starting slot — so a starter still gets the alert, just
 * without a named backup. A bench player there is never "should start": that needs projections.
 */

const IMPACT_TIMEOUT_MS = 8_000

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function toneFor(bucket: StatusBucket): MoveTone | null {
  if (bucket === 'out' || bucket === 'ir' || bucket === 'suspended') return 'bad'
  if (bucket === 'questionable' || bucket === 'doubtful') return 'warn'
  if (bucket === 'active') return 'good'
  return null
}

export async function resolveLineupImpacts(args: {
  userId: string
  leagueIds: readonly string[]
  /** Leagues where his roster slot is a starting one — the fallback when the picker cannot answer. */
  startingLeagueIds: readonly string[]
  sport: string
  sleeperId: string | null
  playerName: string
  team: string | null
  bucket: StatusBucket
  prior: StatusBucket | null
  now?: Date
}): Promise<LeagueLineupImpact[]> {
  const now = args.now ?? new Date()
  const leagueIds = [...new Set(args.leagueIds)]
  if (leagueIds.length === 0) return []
  const starting = new Set(args.startingLeagueIds)

  const fromRoster = async (): Promise<LeagueLineupImpact[]> => {
    const names = await Promise.resolve()
      .then(() => prisma.league.findMany({ where: { id: { in: leagueIds } }, select: { id: true, name: true } }))
      .catch(() => [] as Array<{ id: string; name: string | null }>)
    const nameOf = new Map(names.map((l) => [l.id, l.name ?? 'your league']))
    return leagueIds.map((leagueId) => ({
      leagueId,
      leagueName: nameOf.get(leagueId) ?? 'your league',
      kind: lineupImpactKind({ bucket: args.bucket, prior: args.prior, isStarting: starting.has(leagueId), call: null }),
      startName: null,
      benchName: null,
      delta: null,
      freeAgent: null,
      fixHref: null,
    }))
  }

  if (String(args.sport).toUpperCase() !== 'NFL' || !args.sleeperId) return fromRoster()
  const sleeperId = args.sleeperId

  const picked = await withTimeout(
    (async () => {
      const [{ getPlayerImpact }, { loadNflWeekKickoffs }] = await Promise.all([
        import('@/lib/core-app/playerImpact'),
        import('@/lib/chimmy-alerts/injuryFanOut'),
      ])
      const [impacts, kickoffs] = await Promise.all([getPlayerImpact(sleeperId, args.userId, { leagueIds }), loadNflWeekKickoffs()])
      return { impacts, kickoffs }
    })().catch(() => null),
    IMPACT_TIMEOUT_MS,
  )
  if (!picked || picked.impacts.length === 0) return fromRoster()

  const tone = toneFor(args.bucket)
  const out: LeagueLineupImpact[] = picked.impacts.map((impact) => {
    const call = leagueCall({
      impact,
      player: { sleeperId, name: args.playerName, team: args.team },
      readinessTone: tone,
      kickoffs: picked.kickoffs,
      nowIso: now.toISOString(),
    })
    const kind = lineupImpactKind({ bucket: args.bucket, prior: args.prior, isStarting: impact.isStarting, call })
    const bench = kind === 'bench_should_start'
    return {
      leagueId: impact.leagueId,
      leagueName: impact.leagueName,
      kind,
      startName: bench ? args.playerName : (call.swap?.startName ?? null),
      benchName: bench ? (call.swap?.benchName ?? null) : null,
      delta: bench ? (impact.startOver?.delta ?? null) : null,
      freeAgent: null,
      fixHref: call.fix?.href ?? null,
    }
  })

  // A ruled-out starter with nobody on the bench: the free agent to add, where the viewer may see one.
  const holes = out.filter((i) => i.kind === 'starter_out' && !i.startName).map((i) => i.leagueId)
  if (holes.length) {
    const picks = await withTimeout(
      import('@/lib/chimmy-alerts/injuryFanOut').then(({ freeAgentPicks }) => freeAgentPicks(args.userId, sleeperId, holes, picked.kickoffs, now)),
      IMPACT_TIMEOUT_MS,
    ).catch(() => null)
    for (const i of out) {
      const pick = picks?.get(i.leagueId)
      if (pick) i.freeAgent = { name: pick.name, projectedPoints: pick.projectedPoints }
    }
  }
  return out
}
