/**
 * Start a native zombie league's season once its draft has produced one.
 *
 * 🛑 NOTHING EVER SET `ZombieLeague.status = 'active'`. The wizard creates the row as `setup`, the
 * scheduled resolver (score-sync) only picks up `active`, and every helper that seeds the league's
 * teams or picks the Whisperer had no caller. So a native zombie league never ran a single week:
 * no infections, no serums, no bashings, nothing — while its head-to-head season played on.
 *
 * It belongs here, after the draft, for the same reason the guillotine season shell does: the
 * teams it seeds are the league's rosters and the season it copies is the one the draft sync just
 * created. Idempotent, because post-draft artifacts re-run on polls:
 *   - team rows are create-only;
 *   - the Whisperer is picked ONLY if none has been (re-picking resets ambushes and re-rolls it);
 *   - the status flips only from `setup` / `registering`, so a paused or finished league stays so.
 */
import { prisma } from '@/lib/prisma'
import { ensureLeagueTeamRows } from '@/lib/zombie/ZombieOwnerStatusService'
import { selectWhisperer } from '@/lib/zombie/whispererEngine'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'

export type ZombieActivationResult =
  | { ok: true; activated: boolean; whispererPicked: boolean; zombieLeagueId: string }
  | { ok: false; reason: 'NOT_ZOMBIE' | 'REDRAFT_SEASON_NOT_FOUND' | 'NOT_STARTABLE' }

const STARTABLE = ['setup', 'registering']

export async function ensureZombieSeasonActivated(input: {
  leagueId: string
  redraftSeasonId: string
}): Promise<ZombieActivationResult> {
  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId: input.leagueId },
    select: { id: true, status: true },
  })
  if (!z) return { ok: false, reason: 'NOT_ZOMBIE' }
  if (!STARTABLE.includes(z.status)) return { ok: false, reason: 'NOT_STARTABLE' }

  const season = await prisma.redraftSeason.findFirst({
    where: { id: input.redraftSeasonId, leagueId: input.leagueId },
    select: { season: true, totalWeeks: true },
  })
  if (!season) return { ok: false, reason: 'REDRAFT_SEASON_NOT_FOUND' }

  await ensureLeagueTeamRows(input.leagueId, z.id)

  let whispererPicked = false
  const existing = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId: z.id }, select: { id: true } })
  if (!existing) {
    const cfg = await getZombieLeagueConfig(input.leagueId).catch(() => null)
    const mode = cfg?.whispererSelection === 'veteran_priority' ? 'veteran_priority' : 'random'
    await selectWhisperer(z.id, mode)
    whispererPicked = true
  }

  // The resolver matches matchups by season YEAR, so the zombie league must carry the draft's.
  const flipped = await prisma.zombieLeague.updateMany({
    where: { id: z.id, status: { in: STARTABLE } },
    data: { status: 'active', season: season.season, totalWeeks: season.totalWeeks, currentWeek: 1 },
  })
  return { ok: true, activated: flipped.count > 0, whispererPicked, zombieLeagueId: z.id }
}
