import 'server-only'

/**
 * 11b — per-manager health rows for one league.
 *
 * The league-level snapshot in `commissionerHubHealth.ts` already answers "is
 * this league in trouble". It cannot answer "who", because everything it emits
 * is an aggregate: `inactiveTeams: 2` names nobody, and a commissioner cannot
 * message a count. This module is the missing per-manager breakdown, built from
 * the same real tables that snapshot reads.
 *
 * ⚠ EVERY COLUMN IS A REAL READ OR IT IS NULL. The handoff's table has five data
 * columns and each one below resolves from an actual row:
 *
 *   Lineups     `Roster.playerData` via getNormalizedLineupSections() — the same
 *               normaliser Waiver OS and the exposure engine use, including its
 *               flat-`players[]` fallback for Sleeper-imported rosters that never
 *               ran the lineup_sections migration.
 *   Moves       `WaiverClaim` + `WaiverTransaction` for that roster.
 *   Trades      `AfLeagueTrade` where the roster is either side.
 *   Last action `Roster.updatedAt`, which the sync path touches on every write.
 *   Status      derived from the three above — see `resolveStatus`.
 *
 * ⚠ THE LINEUP DENOMINATOR IS THE LEAGUE'S OWN STARTER COUNT, NOT 11. The
 * screenshot shows `11/11` because that mock league starts eleven; a superflex
 * or a 2QB league does not, and hardcoding 11 would show `11/9` to a real
 * commissioner. `expectedStarters` is resolved per league from `League.starters`
 * and falls back to the widest roster's own starter count rather than a constant.
 *
 * ⚠ NULL LINEUP DATA IS `null`, NEVER ZERO. A roster we could not parse and a
 * roster with nobody in it are different facts, and the second one is an
 * accusation. `lineupsSet: null` renders as an em dash and is excluded from the
 * status derivation — an unreadable roster never gets called INACTIVE.
 */

import { prisma } from '@/lib/prisma'
import { INACTIVE_AFTER_MS } from '@/lib/commissioner-hub/commissionerHubHealth'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

export type ManagerHealthStatus = 'active' | 'at_risk' | 'inactive' | 'unknown'

export type ManagerHealthRow = {
  rosterId: string
  /** `@handle`-style display name, from LeagueTeam.ownerName when it resolves. */
  managerName: string | null
  teamName: string | null
  avatarUrl: string | null
  /** Starters currently filled. `null` when the roster's shape could not be read. */
  lineupsSet: number | null
  expectedStarters: number | null
  moves: number
  trades: number
  lastActionAt: string | null
  status: ManagerHealthStatus
}

export type LeagueManagerHealth = {
  leagueId: string
  rows: ManagerHealthRow[]
  totalManagers: number
  inactiveCount: number
  atRiskCount: number
}

const DAY_MS = 86_400_000

/**
 * ⚠ THESE THRESHOLDS ARE THE SINGLE SOURCE FOR BOTH THE STATUS TAG AND THE
 * COLOUR ON THE LINEUP FRACTION. Handoff build rule 4: if the fraction is tinted
 * from one rule and the tag from another, a row eventually shows a green `11/11`
 * beside a red `INACTIVE` and the whole table stops being believable. The client
 * component reads `status` and derives the fraction's tone from it, rather than
 * re-deciding.
 *
 * ⚠ IDLE TIME IS THE ONLY THING THAT CAN MAKE A MANAGER `inactive`, AND THE
 * WINDOW IS IMPORTED RATHER THAN CHOSEN. An earlier revision of this file also
 * let a thin lineup (<60% of slots filled) mark someone inactive on its own.
 * Rendered against a real preseason league that read `12 managers · 12 inactive`
 * directly beneath an engine abandonment score of 0 — because in week 1 nobody
 * has set a lineup yet, and "has not picked a team before the season starts" is
 * not abandonment. An empty lineup can now only raise a manager to `at_risk`,
 * and only when they are ALSO going quiet.
 */
const AT_RISK_DAYS = 4
/** Below this share of startable slots filled, the lineup is worth a look. */
const AT_RISK_LINEUP_RATIO = 0.9

function resolveStatus(input: {
  lastActionAt: Date | null
  lineupRatio: number | null
  moves: number
  now: number
}): ManagerHealthStatus {
  const { lastActionAt, lineupRatio, moves, now } = input
  const msIdle = lastActionAt ? now - lastActionAt.getTime() : null
  const daysIdle = msIdle == null ? null : msIdle / DAY_MS

  /*
   * No timestamp AND no readable lineup means we know nothing about this
   * manager. `unknown` renders as a neutral dash — the same "no guessed score"
   * rule 11a applies to a failed sync. Calling them inactive would be a guess
   * dressed as a finding.
   */
  if (msIdle == null && lineupRatio == null) return 'unknown'

  // Same window the league-level snapshot counts `inactiveTeams` with.
  if (msIdle != null && msIdle > INACTIVE_AFTER_MS) return 'inactive'

  const goingQuiet = daysIdle != null && daysIdle >= AT_RISK_DAYS
  const thinLineup = lineupRatio != null && lineupRatio < AT_RISK_LINEUP_RATIO
  // `moves === 0` alone is normal in a quiet week; it only counts alongside silence.
  if (goingQuiet || (thinLineup && (goingQuiet || moves === 0))) return 'at_risk'
  return 'active'
}

function countStarters(playerData: unknown): { filled: number; slots: number } | null {
  const sections = getNormalizedLineupSections(playerData)
  const starters = Array.isArray(sections.starters) ? sections.starters : []
  if (starters.length === 0) return null
  /*
   * An empty-string id is a real, common shape: platforms write `"0"` or `""`
   * into a starter slot the manager left blank. That is exactly the signal this
   * column exists to surface, so the slot counts toward the denominator and not
   * the numerator.
   */
  const filled = starters.filter((row) => {
    const id = String((row as Record<string, unknown>)?.id ?? '').trim()
    return id !== '' && id !== '0'
  }).length
  return { filled, slots: starters.length }
}

function resolveExpectedStarters(leagueStarters: unknown, rosterSlotCounts: number[]): number | null {
  if (Array.isArray(leagueStarters) && leagueStarters.length > 0) return leagueStarters.length
  if (typeof leagueStarters === 'number' && Number.isFinite(leagueStarters) && leagueStarters > 0) {
    return Math.round(leagueStarters)
  }
  // Fall back to the widest roster actually observed, never to a constant.
  const widest = rosterSlotCounts.filter((n) => n > 0).sort((a, b) => b - a)[0]
  return widest ?? null
}

export async function getLeagueManagerHealth(leagueId: string): Promise<LeagueManagerHealth> {
  const empty: LeagueManagerHealth = { leagueId, rows: [], totalManagers: 0, inactiveCount: 0, atRiskCount: 0 }
  if (!leagueId) return empty

  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { starters: true } })
    .catch(() => null)

  const rosters = await prisma.roster
    .findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, playerData: true, updatedAt: true },
    })
    .catch(() => [] as Array<{ id: string; platformUserId: string; playerData: unknown; updatedAt: Date }>)

  if (rosters.length === 0) return empty

  const rosterIds = rosters.map((r) => r.id)
  const platformUserIds = rosters.map((r) => r.platformUserId).filter(Boolean)

  /*
   * Identity comes from LeagueTeam, joined on platformUserId — the same join the
   * rest of the commissioner surfaces use. ⚠ Never gate on this being present:
   * `LeagueTeam.platformUserId` is nullable and an unclaimed/orphan team legally
   * has none, so a missing row means "no display name", not "no manager".
   */
  const [teams, waiverClaims, waiverTx, tradesProposed, tradesReceived] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: { platformUserId: true, ownerName: true, teamName: true, avatarUrl: true, legacyRosterId: true },
      })
      .catch(() => [] as Array<{ platformUserId: string | null; ownerName: string; teamName: string; avatarUrl: string | null; legacyRosterId: string | null }>),
    prisma.waiverClaim
      .groupBy({ by: ['rosterId'], where: { rosterId: { in: rosterIds } }, _count: { _all: true } })
      .catch(() => [] as Array<{ rosterId: string; _count: { _all: number } }>),
    prisma.waiverTransaction
      .groupBy({ by: ['rosterId'], where: { rosterId: { in: rosterIds } }, _count: { _all: true } })
      .catch(() => [] as Array<{ rosterId: string; _count: { _all: number } }>),
    prisma.afLeagueTrade
      .groupBy({ by: ['proposerRosterId'], where: { proposerRosterId: { in: rosterIds } }, _count: { _all: true } })
      .catch(() => [] as Array<{ proposerRosterId: string; _count: { _all: number } }>),
    prisma.afLeagueTrade
      .groupBy({ by: ['receiverRosterId'], where: { receiverRosterId: { in: rosterIds } }, _count: { _all: true } })
      .catch(() => [] as Array<{ receiverRosterId: string; _count: { _all: number } }>),
  ])

  const teamByPlatformId = new Map<string, (typeof teams)[number]>()
  const teamByLegacyRosterId = new Map<string, (typeof teams)[number]>()
  for (const t of teams) {
    if (t.platformUserId) teamByPlatformId.set(t.platformUserId, t)
    if (t.legacyRosterId) teamByLegacyRosterId.set(t.legacyRosterId, t)
  }

  const countBy = <K extends string>(rows: Array<Record<string, unknown>>, key: K): Map<string, number> => {
    const m = new Map<string, number>()
    for (const row of rows) {
      const id = String(row[key] ?? '')
      if (!id) continue
      const n = Number((row as { _count?: { _all?: number } })._count?._all ?? 0)
      m.set(id, (m.get(id) ?? 0) + n)
    }
    return m
  }

  const claimCounts = countBy(waiverClaims as unknown as Array<Record<string, unknown>>, 'rosterId')
  const txCounts = countBy(waiverTx as unknown as Array<Record<string, unknown>>, 'rosterId')
  const proposedCounts = countBy(tradesProposed as unknown as Array<Record<string, unknown>>, 'proposerRosterId')
  const receivedCounts = countBy(tradesReceived as unknown as Array<Record<string, unknown>>, 'receiverRosterId')

  const starterShapes = rosters.map((r) => countStarters(r.playerData))
  const expectedStarters = resolveExpectedStarters(
    league?.starters,
    starterShapes.map((s) => s?.slots ?? 0),
  )

  const now = Date.now()
  const rows: ManagerHealthRow[] = rosters.map((roster, i) => {
    const shape = starterShapes[i]
    const team = teamByPlatformId.get(roster.platformUserId) ?? teamByLegacyRosterId.get(roster.id) ?? null
    const moves = (claimCounts.get(roster.id) ?? 0) + (txCounts.get(roster.id) ?? 0)
    const trades = (proposedCounts.get(roster.id) ?? 0) + (receivedCounts.get(roster.id) ?? 0)
    const denominator = expectedStarters ?? shape?.slots ?? null
    const lineupRatio = shape && denominator && denominator > 0 ? shape.filled / denominator : null

    return {
      rosterId: roster.id,
      managerName: team?.ownerName?.trim() || null,
      teamName: team?.teamName?.trim() || null,
      avatarUrl: team?.avatarUrl ?? null,
      lineupsSet: shape ? shape.filled : null,
      expectedStarters: denominator,
      moves,
      trades,
      lastActionAt: roster.updatedAt ? roster.updatedAt.toISOString() : null,
      status: resolveStatus({ lastActionAt: roster.updatedAt ?? null, lineupRatio, moves, now }),
    }
  })

  /*
   * Worst first. A commissioner opens this table to find who needs a message,
   * and burying the two inactive managers alphabetically among twelve is how a
   * table becomes something nobody reads.
   */
  const order: Record<ManagerHealthStatus, number> = { inactive: 0, at_risk: 1, unknown: 2, active: 3 }
  rows.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
    const at = a.lastActionAt ? Date.parse(a.lastActionAt) : 0
    const bt = b.lastActionAt ? Date.parse(b.lastActionAt) : 0
    return at - bt
  })

  return {
    leagueId,
    rows,
    totalManagers: rows.length,
    inactiveCount: rows.filter((r) => r.status === 'inactive').length,
    atRiskCount: rows.filter((r) => r.status === 'at_risk').length,
  }
}
