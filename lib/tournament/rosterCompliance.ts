/**
 * Which managers are breaking the tournament's roster rules, across every league.
 *
 * 🛑 A COMMISSIONER CANNOT POLICE TWENTY LEAGUES BY HAND. The rules are uniform
 * — a roster cap, no IR — and the only way to check them today is to open twenty
 * league pages and count. So they do not get checked, and the rule exists on
 * paper only.
 *
 * ⚠ WHAT THIS CAN AND CANNOT SEE, STATED RATHER THAN IMPLIED. It reads the
 * roster an import committed, so it can count players and spot an occupied IR
 * slot. It CANNOT see a trade: a completed trade on the host platform shows up
 * here as two rosters that changed between syncs, with no record that a trade is
 * what changed them. Reporting "no trade violations" would therefore be a claim
 * this module has no evidence for, so it reports the rule as unenforceable
 * instead — see `unenforceable` in the result.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveRoundRosterSize } from '@/lib/tournament/rosterRules'

export type ViolationKind = 'roster_too_large' | 'ir_used' | 'no_roster'

export type Violation = {
  kind: ViolationKind
  leagueName: string
  /** The manager's handle on the host platform — what a commissioner would @. */
  displayName: string
  detail: string
  /** Counted where there is something to count; null when the roster is unreadable. */
  observed: number | null
  limit: number | null
}

export type ComplianceReport = {
  tournamentId: string
  roundNumber: number
  rosterLimit: number
  irAllowed: boolean
  checkedManagers: number
  violations: Violation[]
  /** Rules that cannot be checked from imported data, and why. */
  unenforceable: Array<{ rule: string; reason: string }>
  /** Leagues with no roster rows at all — a sync problem, not a rule problem. */
  leaguesWithoutRosters: string[]
}

type PlayerData = {
  players?: unknown
  starters?: unknown
  reserve?: unknown
  taxi?: unknown
}

function countIds(value: unknown): number | null {
  if (!Array.isArray(value)) return null
  /*
   * ⚠ SLEEPER PADS EMPTY LINEUP SLOTS WITH "0". Counting those as players
   * inflates every roster by however many slots are unfilled, which would report
   * a violation against a manager who is under the cap.
   */
  return value.filter((v) => v != null && String(v) !== '0' && String(v) !== '').length
}

export async function checkTournamentRosterCompliance(
  tournamentId: string,
  commissionerUserId: string,
): Promise<ComplianceReport | null> {
  const shell = await prisma.tournamentShell.findFirst({
    where: { id: tournamentId, commissionerId: commissionerUserId },
    select: {
      id: true,
      currentRoundNumber: true,
      openingRosterSize: true,
      tournamentRosterSize: true,
      eliteRosterSize: true,
      irEnabled: true,
      tradeEnabled: true,
    },
  })
  /* Same answer for "not found" and "not yours". */
  if (!shell) return null

  const roundNumber = shell.currentRoundNumber || 1
  const round = await prisma.tournamentRound.findFirst({
    where: { tournamentId, roundNumber },
    select: { roundNumber: true, roundType: true, rosterSizeOverride: true },
  })

  const rosterLimit = resolveRoundRosterSize(
    shell,
    round ?? { roundNumber, roundType: 'opening', rosterSizeOverride: null },
  )

  /*
   * 🛑 SCOPED TO THE CURRENT ROUND, AND IT WAS NOT UNTIL THE REDRAFT EXISTED.
   * Reading every `TournamentLeague` in the tournament was harmless while there
   * was only ever one round of them. The moment a redraft commits round-2 slots,
   * an unscoped read returns the old leagues AND the new ones — the same manager
   * twice, ranked against himself, in a table that decides who goes home.
   */
  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, leagueId: { not: null }, round: { roundNumber } },
    select: { leagueId: true, name: true },
  })
  const leagueIds = leagues.map((l) => l.leagueId!).filter(Boolean)
  const nameByLeagueId = new Map(leagues.map((l) => [l.leagueId!, l.name]))

  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId: { in: leagueIds } },
      select: { leagueId: true, platformUserId: true, playerData: true },
    }),
    /* The handle to show and to @ — `Roster` carries only a platform user id. */
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: leagueIds } },
      select: {
        leagueId: true,
        platformUserId: true,
        claimedByUserId: true,
        ownerName: true,
        teamName: true,
      },
    }),
  ])

  /*
   * ⚠ BOTH ID SPACES. `Roster.platformUserId` holds the platform id for imported
   * managers and the `AppUser.id` for the viewer's claimed team, so a
   * single-key index leaves the commissioner's own violations labelled with a
   * raw id.
   */
  const handleFor = new Map<string, string>()
  for (const t of teams) {
    const label = t.ownerName?.trim() || t.teamName?.trim() || t.platformUserId || 'Unknown manager'
    if (t.platformUserId) handleFor.set(`${t.leagueId}:${t.platformUserId}`, label)
    if (t.claimedByUserId) handleFor.set(`${t.leagueId}:${t.claimedByUserId}`, label)
  }

  const leaguesWithRosters = new Set(rosters.map((r) => r.leagueId))
  const violations: Violation[] = []

  for (const r of rosters) {
    const leagueName = nameByLeagueId.get(r.leagueId) ?? 'League'
    const displayName = handleFor.get(`${r.leagueId}:${r.platformUserId}`) ?? r.platformUserId
    const data = (r.playerData ?? {}) as PlayerData

    const playerCount = countIds(data.players)
    if (playerCount == null) {
      /*
       * ⚠ UNREADABLE IS NOT COMPLIANT. Skipping a roster we cannot parse would
       * quietly shrink the field being policed, and the manager with the broken
       * import is exactly the one worth looking at.
       */
      violations.push({
        kind: 'no_roster',
        leagueName,
        displayName,
        detail: 'No readable roster on file — re-sync this league before judging it.',
        observed: null,
        limit: rosterLimit,
      })
      continue
    }

    if (rosterLimit > 0 && playerCount > rosterLimit) {
      violations.push({
        kind: 'roster_too_large',
        leagueName,
        displayName,
        detail: `${playerCount} players rostered, limit is ${rosterLimit}.`,
        observed: playerCount,
        limit: rosterLimit,
      })
    }

    const reserveCount = countIds(data.reserve) ?? 0
    if (!shell.irEnabled && reserveCount > 0) {
      violations.push({
        kind: 'ir_used',
        leagueName,
        displayName,
        detail: `${reserveCount} ${reserveCount === 1 ? 'player' : 'players'} on IR, which this tournament does not allow.`,
        observed: reserveCount,
        limit: 0,
      })
    }
  }

  const unenforceable: ComplianceReport['unenforceable'] = []
  if (!shell.tradeEnabled) {
    unenforceable.push({
      rule: 'No trades',
      reason:
        'A completed trade on the host platform reaches AllFantasy as two rosters that changed between syncs, with nothing recording that a trade is what changed them. This check cannot see them, so it does not claim there were none.',
    })
  }

  return {
    tournamentId,
    roundNumber,
    rosterLimit,
    irAllowed: shell.irEnabled,
    checkedManagers: rosters.length,
    violations: violations.sort(
      (a, b) => a.leagueName.localeCompare(b.leagueName) || a.displayName.localeCompare(b.displayName),
    ),
    unenforceable,
    leaguesWithoutRosters: leagueIds
      .filter((id) => !leaguesWithRosters.has(id))
      .map((id) => nameByLeagueId.get(id) ?? id),
  }
}
