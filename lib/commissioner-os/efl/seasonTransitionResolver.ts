/**
 * (A) The EFL season transition resolver — who goes up, who goes down, and what is still open.
 *
 * 🛑 IT RUNS BEFORE `PromotionEngine`, NOT INSTEAD OF IT, AND IT REWRITES NOTHING.
 * `PromotionEngine` owns generic standings-zone movement and is untouched. This resolver owns the
 * half that is EFL competition policy: the bottom team drops automatically, but the *next two* play
 * a one-week playoff and the LOSER drops. `PromotionEngine` decides by zone alone and would take
 * the bottom three by record — which is a different competition.
 *
 * It emits the existing canonical `SeasonEndTransition`, so its output is drop-in compatible with
 * whatever eventually applies it.
 *
 * ⚠ IT IS SAFE TO CALL BEFORE THE PLAYOFFS FINISH, WHICH IS THE POINT. Commissioner OS wants to
 * show "these two are already down, these four are playing for the last two places" during the
 * final week. So an unknown outcome produces a PENDING entry, never a guess, and suppresses
 * `finalTransitions` entirely.
 *
 * Pure: standings and outcomes in, a plan out. No DB, no clock, no randomness.
 */

import type {
  EflPendingPlayoff,
  EflPlayoffOutcome,
  EflSeasonTransitionPlan,
  EflTierStanding,
  EflTierTeam,
  EflTransitionConfig,
  SeasonEndTransition,
} from '@/lib/commissioner-os/efl/types'
import { EFL_DEFAULT_TRANSITION_CONFIG } from '@/lib/commissioner-os/efl/types'

export type ResolveEflSeasonTransitionsInput = {
  leagueId: string
  season: number
  /** One entry per tier. Order does not matter; the resolver sorts by tierLevel. */
  tiers: readonly EflTierStanding[]
  /** Known playoff results. Omit or leave short while playoffs are still being played. */
  playoffOutcomes?: readonly EflPlayoffOutcome[]
  config?: EflTransitionConfig
}

/**
 * Structural roles a team can hold coming out of the regular season.
 *
 * Exported because the rookie-draft-order resolver reads exactly these — slots 6-11 and 15-27 are
 * named by role, not by rank — and deriving them twice from the standings would be two
 * implementations of one rule.
 */
export type EflTierRoles = {
  tierLevel: number
  divisionId: string
  label: string
  autoPromoted: EflTierTeam[]
  promotionPlayoffParticipants: EflTierTeam[]
  autoRelegated: EflTierTeam[]
  relegationPlayoffParticipants: EflTierTeam[]
  /**
   * Everyone not claimed by a role above.
   *
   * ⚠ THIS IS THE REVERSE-MAX-PF POOL AND IT IS DERIVED, NOT LISTED. In League 2 the three
   * promotion-contending teams are excluded and five remain; in League 1 and the Championship six
   * are excluded and two remain. Those are exactly the "1-5", "12-13" and "20-21" bands of the
   * published draft order, and deriving them means changing a playoff count cannot silently leave
   * the draft order the wrong length.
   */
  unclaimed: EflTierTeam[]
}

function byRank(a: EflTierTeam, b: EflTierTeam): number {
  return a.rank - b.rank
}

/**
 * Assign structural roles within one tier.
 *
 * 🛑 TWO INDEPENDENT GUARDS DECIDE WHETHER A TIER MOVES, AND BOTH ARE REQUIRED.
 *
 *   1. The CONFIG exemption (`noRelegationFromTierLevels`) — the commissioner's stated rule.
 *   2. ADJACENCY — is there actually a tier below to fall into?
 *
 * For EFL today they agree: League 2 is both exempt and the bottom tier. They are kept separate
 * because a commissioner who adds a fifth tier expects League 2 to start relegating, and a
 * commissioner who exempts a MIDDLE tier expects that to hold even though a tier below exists.
 * Collapsing them to one check silently answers one of those two questions wrong.
 */
function resolveTierRoles(
  tier: EflTierStanding,
  config: EflTransitionConfig,
  hasTierAbove: boolean,
  hasTierBelow: boolean,
): EflTierRoles {
  const ordered = [...tier.teams].sort(byRank)
  const claimed = new Set<string>()

  const take = (teams: EflTierTeam[]): EflTierTeam[] => {
    for (const t of teams) claimed.add(t.teamId)
    return teams
  }

  const promotionAllowed = hasTierAbove && !config.noPromotionFromTierLevels.includes(tier.tierLevel)
  const relegationAllowed = hasTierBelow && !config.noRelegationFromTierLevels.includes(tier.tierLevel)

  const autoPromoted = promotionAllowed
    ? take(ordered.slice(0, Math.max(0, config.autoPromoteCount)))
    : []

  const promotionPlayoffParticipants = promotionAllowed
    ? take(
        ordered
          .slice(Math.max(0, config.autoPromoteCount))
          .slice(0, Math.max(0, config.promotionPlayoffCount)),
      )
    : []

  /*
   * ⚠ RELEGATION COUNTS FROM THE BOTTOM, SO IT IS SLICED FROM THE END. The bottom team is the LAST
   * in rank order, and the relegation playoff pair is the two immediately above it. Reading these
   * off the front would relegate the tier winner.
   */
  const fromBottom = [...ordered].reverse()
  const autoRelegated = relegationAllowed
    ? take(fromBottom.slice(0, Math.max(0, config.autoRelegateCount)).sort(byRank))
    : []

  const relegationPlayoffParticipants = relegationAllowed
    ? take(
        fromBottom
          .slice(Math.max(0, config.autoRelegateCount))
          .slice(0, Math.max(0, config.relegationPlayoffCount))
          .sort(byRank),
      )
    : []

  return {
    tierLevel: tier.tierLevel,
    divisionId: tier.divisionId,
    label: tier.label,
    autoPromoted,
    promotionPlayoffParticipants,
    autoRelegated,
    relegationPlayoffParticipants,
    unclaimed: ordered.filter((t) => !claimed.has(t.teamId)),
  }
}

/** Roles for every tier, keyed by tierLevel. Shared with the draft-order resolver. */
export function resolveEflTierRoles(
  tiers: readonly EflTierStanding[],
  config: EflTransitionConfig = EFL_DEFAULT_TRANSITION_CONFIG,
): Map<number, EflTierRoles> {
  const sorted = [...tiers].sort((a, b) => a.tierLevel - b.tierLevel)
  const levels = new Set(sorted.map((t) => t.tierLevel))
  const out = new Map<number, EflTierRoles>()

  for (const tier of sorted) {
    out.set(
      tier.tierLevel,
      resolveTierRoles(
        tier,
        config,
        /* hasTierAbove */ levels.has(tier.tierLevel - 1),
        /* hasTierBelow */ levels.has(tier.tierLevel + 1),
      ),
    )
  }
  return out
}

function transition(
  team: EflTierTeam,
  from: { tierLevel: number; divisionId: string },
  to: { tierLevel: number; divisionId: string },
  type: 'promotion' | 'relegation',
): SeasonEndTransition {
  return {
    teamId: team.teamId,
    teamName: team.teamName,
    fromDivisionId: from.divisionId,
    fromTierLevel: from.tierLevel,
    toDivisionId: to.divisionId,
    toTierLevel: to.tierLevel,
    type,
  }
}

export function resolveEflSeasonTransitions(
  input: ResolveEflSeasonTransitionsInput,
): EflSeasonTransitionPlan {
  const config = input.config ?? EFL_DEFAULT_TRANSITION_CONFIG
  const roles = resolveEflTierRoles(input.tiers, config)
  const byLevel = new Map(input.tiers.map((t) => [t.tierLevel, t]))

  const automaticTransitions: SeasonEndTransition[] = []
  const resolvedPlayoffTransitions: SeasonEndTransition[] = []
  const pendingPlayoffs: EflPendingPlayoff[] = []
  const unresolvedReasons: string[] = []
  const conflicts: string[] = []

  const outcomeFor = (kind: 'promotion' | 'relegation', tierLevel: number) =>
    (input.playoffOutcomes ?? []).find((o) => o.kind === kind && o.tierLevel === tierLevel) ?? null

  /*
   * ⚠ ITERATED IN TIER ORDER SO THE OUTPUT IS DETERMINISTIC. A Map preserves insertion order, and
   * `resolveEflTierRoles` sorts before inserting, so this is stable regardless of the order the
   * caller supplied the tiers in.
   */
  for (const [tierLevel, role] of roles) {
    const above = byLevel.get(tierLevel - 1) ?? null
    const below = byLevel.get(tierLevel + 1) ?? null
    const here = { tierLevel, divisionId: role.divisionId }

    // ── automatic promotion ────────────────────────────────────────────────
    if (above) {
      for (const team of role.autoPromoted) {
        automaticTransitions.push(
          transition(team, here, { tierLevel: above.tierLevel, divisionId: above.divisionId }, 'promotion'),
        )
      }
    }

    // ── automatic relegation ───────────────────────────────────────────────
    if (below) {
      for (const team of role.autoRelegated) {
        automaticTransitions.push(
          transition(team, here, { tierLevel: below.tierLevel, divisionId: below.divisionId }, 'relegation'),
        )
      }
    }

    // ── promotion playoff: the WINNER goes up ──────────────────────────────
    if (above && role.promotionPlayoffParticipants.length > 0) {
      const outcome = outcomeFor('promotion', tierLevel)
      if (!outcome) {
        pendingPlayoffs.push({
          kind: 'promotion',
          tierLevel,
          divisionId: role.divisionId,
          label: `${role.label} promotion playoff`,
          participants: role.promotionPlayoffParticipants,
          reason: 'No recorded result.',
        })
        unresolvedReasons.push(
          `${role.label} promotion playoff has no recorded result; one promotion place is undecided.`,
        )
      } else {
        const participantIds = new Set(role.promotionPlayoffParticipants.map((t) => t.teamId))
        /*
         * 🛑 AN OUTCOME NAMING A TEAM THAT IS NOT IN THE PLAYOFF IS A CONTRADICTION, NOT A
         * PROMOTION. Accepting it would move a team that never qualified — silently, with no
         * conflict marker anywhere, because nothing else in the chain re-checks eligibility.
         */
        if (!participantIds.has(outcome.winnerTeamId) || !participantIds.has(outcome.loserTeamId)) {
          conflicts.push(
            `${role.label} promotion playoff outcome names a team that did not qualify for it.`,
          )
        } else if (outcome.winnerTeamId === outcome.loserTeamId) {
          conflicts.push(`${role.label} promotion playoff names the same team as winner and loser.`)
        } else {
          const winner = role.promotionPlayoffParticipants.find((t) => t.teamId === outcome.winnerTeamId)!
          resolvedPlayoffTransitions.push(
            transition(winner, here, { tierLevel: above.tierLevel, divisionId: above.divisionId }, 'promotion'),
          )
        }
      }
    }

    // ── relegation playoff: the LOSER goes down ────────────────────────────
    if (below && role.relegationPlayoffParticipants.length > 0) {
      const outcome = outcomeFor('relegation', tierLevel)
      if (!outcome) {
        pendingPlayoffs.push({
          kind: 'relegation',
          tierLevel,
          divisionId: role.divisionId,
          label: `${role.label} relegation playoff`,
          participants: role.relegationPlayoffParticipants,
          reason: 'No recorded result.',
        })
        unresolvedReasons.push(
          `${role.label} relegation playoff has no recorded result; one relegation place is undecided.`,
        )
      } else {
        const participantIds = new Set(role.relegationPlayoffParticipants.map((t) => t.teamId))
        if (!participantIds.has(outcome.winnerTeamId) || !participantIds.has(outcome.loserTeamId)) {
          conflicts.push(
            `${role.label} relegation playoff outcome names a team that did not qualify for it.`,
          )
        } else if (outcome.winnerTeamId === outcome.loserTeamId) {
          conflicts.push(`${role.label} relegation playoff names the same team as winner and loser.`)
        } else {
          const loser = role.relegationPlayoffParticipants.find((t) => t.teamId === outcome.loserTeamId)!
          resolvedPlayoffTransitions.push(
            transition(loser, here, { tierLevel: below.tierLevel, divisionId: below.divisionId }, 'relegation'),
          )
        }
      }
    }
  }

  /*
   * 🛑 A TEAM MOVING TWICE, OR MOVING BOTH WAYS, IS A CONTRADICTION THE APPLIER CANNOT SEE.
   * `prisma.leagueTeam.update({ divisionId })` is last-write-wins, so two transitions for one team
   * apply cleanly and land wherever the iteration happened to finish. Caught here, where the reason
   * is still knowable.
   */
  const all = [...automaticTransitions, ...resolvedPlayoffTransitions]
  const seen = new Map<string, SeasonEndTransition>()
  for (const t of all) {
    const prior = seen.get(t.teamId)
    if (prior) {
      conflicts.push(
        `${t.teamName} has two transitions: ${prior.type} to tier ${prior.toTierLevel} and ${t.type} to tier ${t.toTierLevel}.`,
      )
      continue
    }
    seen.set(t.teamId, t)
  }

  const settled = pendingPlayoffs.length === 0 && conflicts.length === 0

  /*
   * ⚠ SORTED BY (toTierLevel, teamId) SO THE PLAN IS BYTE-STABLE. The applier order does not
   * matter for correctness — each update touches one row — but an unstable order makes a plan
   * impossible to diff between runs, which is what an audit needs.
   */
  const finalTransitions = settled
    ? [...all].sort((a, b) => a.toTierLevel - b.toTierLevel || (a.teamId < b.teamId ? -1 : 1))
    : null

  return {
    leagueId: input.leagueId,
    season: input.season,
    automaticTransitions,
    pendingPlayoffs,
    resolvedPlayoffTransitions,
    unresolvedReasons,
    conflicts,
    finalTransitions,
  }
}
