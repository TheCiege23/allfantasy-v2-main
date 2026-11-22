/**
 * Hand every empty seat in a league to Chimmy, for the commissioner's "Fill empty slots" button.
 *
 * 🛑 THE BUTTON DID NOTHING IN A LEAGUE ALLFANTASY HOSTS. It counted `leagueSize - teams` and created
 * that many new teams. A league created here already has one team per seat, the open ones owned by
 * `open-slot-<leagueId>-<n>` (lib/league/leagueSeats.ts), so the count was always zero and the answer
 * was "All slots are already filled" over a league with three empty seats. Reported by the owner on a
 * 4-team test league, 2026-11-21.
 *
 * An empty seat is one whose roster owner is not an account (the `countSeatsHeldByPeople` rule). Each
 * goes through the one switch every engine reads (`applyChimmyAutopilot`), which also enforces the
 * limits: 4 teams a league, 1 without the plan. The first refusal stops the run and is reported; seats
 * handed over before it stay handed over.
 */
import { prisma } from '@/lib/prisma'
import { applyChimmyAutopilot } from './inactiveManagerService'
import { isChimmyRunning, readManagedLineups, type ManagedLineups } from './inactiveManagerMode'

type SeatRow = { id: string; platformUserId: string }

/** Pure: the empty seats, split into those Chimmy already runs and those still to hand over. */
export function openSeatsForChimmy(rosters: readonly SeatRow[], accountIds: ReadonlySet<string>, managed: ManagedLineups): { toHand: string[]; already: string[] } {
  const open = rosters.filter((r) => !accountIds.has(r.platformUserId))
  const already = open.filter((r) => isChimmyRunning(managed, r.id, r.platformUserId)).map((r) => r.id)
  const taken = new Set(already)
  return { toHand: open.filter((r) => !taken.has(r.id)).map((r) => r.id).sort(), already }
}

export type HandOpenSeatsResult = {
  /** Empty seats found, whoever runs them. */
  openSeats: number
  handed: string[]
  alreadyChimmy: number
  /** Why the run stopped early (the limit, the plan), in the words the switch gave. */
  stoppedBy: { status: number; error: string } | null
}

export async function handOpenSeatsToChimmy(leagueId: string, userId: string): Promise<HandOpenSeatsResult> {
  const [rosters, league] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
  ])
  const ids = [...new Set(rosters.map((r) => r.platformUserId).filter(Boolean))]
  const accounts = ids.length ? await prisma.appUser.findMany({ where: { id: { in: ids } }, select: { id: true } }) : []
  const plan = openSeatsForChimmy(rosters, new Set(accounts.map((a) => a.id)), readManagedLineups(league?.settings))
  const handed: string[] = []
  let stoppedBy: HandOpenSeatsResult['stoppedBy'] = null
  for (const rosterId of plan.toHand) {
    const res = await applyChimmyAutopilot(leagueId, userId, rosterId, undefined)
    if (!res.ok) { stoppedBy = { status: res.status, error: res.error }; break }
    handed.push(rosterId)
  }
  return { openSeats: plan.toHand.length + plan.already.length, handed, alreadyChimmy: plan.already.length, stoppedBy }
}
