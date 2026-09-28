/**
 * READ-ONLY. The NCAAF lineup lock against the known test database's real CFBD schedule and real
 * NCAAF pool team names: how many pool teams resolve to a kickoff for a week, and a sample of locks.
 * Writes nothing. Never accepts a production host.
 *
 *   node <launcher> scripts/probe-ncaaf-lineup-lock-testdb.ts [week] [nowIso]
 */
import { prisma } from '../lib/prisma'
import { buildWeekKickoffMap, hydrateRedraftLineupLocks } from '../lib/redraft/lineupLock'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  const week = Number(process.argv[2] ?? 4)
  const now = new Date(process.argv[3] ?? '2026-09-26T17:00:00.000Z')
  try {
    const map = await buildWeekKickoffMap(prisma as never, { sport: 'NCAAFB', season: 2026, week })
    const teams = await prisma.sportsPlayer.groupBy({ by: ['team'], where: { sport: 'NCAAF', team: { not: null } }, _count: { _all: true } })
    const players = teams.map((t, i) => ({ playerId: `probe-${i}`, team: t.team, n: t._count._all }))
    const { players: stamped, warnings } = await hydrateRedraftLineupLocks(prisma as never, {
      sport: 'NCAAFB', season: 2026, week, rosterId: 'probe', leagueSettings: {}, players, now,
    })
    const locked = stamped.filter((p) => p.isLocked)
    const sample = (names: RegExp) => stamped.filter((p) => names.test(String(p.team))).map((p) => `${p.team}: ${p.isLocked ? 'locked' : 'open'}`)
    console.log(JSON.stringify({
      target: 'known test DB (read-only)', week, now: now.toISOString(),
      kickoffKeys: map.byTeam.size, firstKickoff: map.firstKickoff, warnings,
      poolTeams: players.length, poolTeamsLockedAtNow: locked.length,
      sample: sample(/^(University of Mississippi|Vanderbilt University|University of Miami|Miami University|University of Illinois|San Jose State University|Southern Methodist University)$/),
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error('probe failed:', e.code ?? e.message); process.exitCode = 1 })
