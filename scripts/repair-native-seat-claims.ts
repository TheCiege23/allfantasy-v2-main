/**
 * Repair native seats whose `LeagueTeam` does not name their holder (2026-10-01).
 *
 * A person holds the roster (`Roster.platformUserId` is an AppUser id) but the seat's team row is
 * missing, unclaimed, or claimed by something that is not a person. Every reader that finds "your
 * team" by `LeagueTeam.claimedByUserId` — the redraft member check, the Career Wire, the home brief,
 * the standings — cannot see that manager. Two writers produced it: `/api/leagues/join` created the
 * row with no claim, and `assignLeagueSeat` never created a missing one. Both are fixed; this
 * repairs what they already wrote.
 *
 * ⚠ IT DOES NOT WRITE ITS OWN FIX. Each seat goes through `assignLeagueSeat` — the one writer for a
 * seat (`lib/league/leagueSeats.ts`) — as a re-assertion by its current holder, so the roster, the
 * team, the entry slot, the membership and the season roster move together exactly as a real claim
 * would. A team claimed by a DIFFERENT person is a conflict, reported and never touched.
 *
 * Default mode is a dry run (no DB writes). Prints ids only.
 *
 * Usage:
 *   node --env-file=.env.test --require ./scripts/_audit-preload.cjs --import tsx scripts/repair-native-seat-claims.ts
 *   node --env-file=<target> --require ./scripts/_audit-preload.cjs --import tsx scripts/repair-native-seat-claims.ts --apply
 *
 * 🛑 `.env` and `.env.local` point at PRODUCTION. Name the target file deliberately.
 */

import { PrismaClient } from '@prisma/client'
import { assignLeagueSeat } from '../lib/league/leagueSeats'
import { isNativePlatform } from '../lib/league/isNativeLeague'

const prisma = new PrismaClient()

type Finding = {
  leagueId: string
  rosterId: string
  holder: string
  state: 'no_team' | 'unclaimed' | 'non_person_claim' | 'other_person_claim'
}

async function findSeats(): Promise<Finding[]> {
  // Classified in JS by the shared predicate: it lowercases, which a Prisma `in` cannot.
  const leagues = await prisma.league.findMany({ select: { id: true, platform: true } })
  const leagueIds = leagues.filter((l) => isNativePlatform(l.platform)).map((l) => l.id)
  if (leagueIds.length === 0) return []

  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId: { in: leagueIds } }, select: { id: true, leagueId: true, platformUserId: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, externalId: true, claimedByUserId: true } }),
  ])
  const ids = [...new Set([...rosters.map((r) => r.platformUserId), ...teams.map((t) => t.claimedByUserId)].filter((v): v is string => Boolean(v)))]
  const people = new Set((await prisma.appUser.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id))
  const teamOf = new Map(teams.map((t) => [`${t.leagueId}:${t.externalId}`, t]))

  const out: Finding[] = []
  for (const r of rosters) {
    if (!people.has(r.platformUserId)) continue // an open, orphan or placeholder seat
    const team = teamOf.get(`${r.leagueId}:${r.id}`)
    if (team?.claimedByUserId === r.platformUserId) continue
    const state: Finding['state'] = !team
      ? 'no_team'
      : !team.claimedByUserId
        ? 'unclaimed'
        : people.has(team.claimedByUserId)
          ? 'other_person_claim'
          : 'non_person_claim'
    out.push({ leagueId: r.leagueId, rosterId: r.id, holder: r.platformUserId, state })
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const seats = await findSeats()
  const byState = seats.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.state]: (acc[s.state] ?? 0) + 1 }), {})
  console.log(`[repair-native-seat-claims] ${apply ? 'APPLY' : 'dry run'} — ${seats.length} seat(s)`, byState)

  let repaired = 0
  for (const s of seats) {
    if (s.state === 'other_person_claim') {
      console.log(`  CONFLICT  league=${s.leagueId} roster=${s.rosterId} — team claimed by another person; left alone`)
      continue
    }
    if (!apply) {
      console.log(`  would repair  league=${s.leagueId} roster=${s.rosterId} (${s.state})`)
      continue
    }
    const result = await prisma.$transaction((tx) =>
      assignLeagueSeat(tx, { leagueId: s.leagueId, rosterId: s.rosterId, userId: s.holder }),
    )
    if (result.ok) repaired += 1
    console.log(`  ${result.ok ? 'repaired' : `REFUSED ${result.code}`}  league=${s.leagueId} roster=${s.rosterId} (${s.state})`)
  }
  if (apply) console.log(`[repair-native-seat-claims] repaired ${repaired} of ${seats.length}`)
}

main()
  .catch((error) => {
    console.error('[repair-native-seat-claims] failed:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
