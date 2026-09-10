/**
 * (C) The EFL rookie draft order — a composable slot-rule resolver.
 *
 * 🛑 NOT THIRTY-TWO IF-STATEMENTS, AND NOT AN EFL-ONLY ENGINE. The order is DATA — a list of slot
 * RULES (`EFL_ROOKIE_DRAFT_ORDER_V1`) fed to a generic resolver. A commissioner who moves the
 * promotion playoff winner from slot 9 to slot 8 edits one array entry; a commissioner running a
 * three-tier ladder writes a shorter spec. Nothing about "32" or "Premier League" is compiled into
 * the resolver.
 *
 * ## The one derivation that makes this work
 *
 * ⚠ THE REVERSE-MAX-PF POOL IS DERIVED FROM WHAT THE STRUCTURAL ROLES DID NOT CLAIM, NEVER LISTED
 * BY RANK. In League 2 the auto-promoted team and the two promotion-playoff teams are spoken for,
 * so five remain — which is exactly the published "slots 1-5, League 2 Reverse Max PF". In League 1
 * and the Championship six are spoken for and two remain: "12-13" and "20-21". Deriving it means a
 * commissioner who changes `promotionPlayoffCount` cannot leave a draft order that is silently the
 * wrong length, because the pool and the spec would disagree loudly instead.
 *
 * ## Where the numbers come from
 *
 * 🛑 THE FROZEN SNAPSHOT, NEVER A LIVE TOTAL. `resolveEflRookieDraftOrder` takes a
 * `MaxPfFreezeSnapshot` and reads `rows`. It has no access to `LeagueTeam.pointsFor` and cannot
 * accidentally sort on a running total — which is the failure mode `lib/league/rookieDraftOrder.ts`
 * ships today under the name `reverse_max_pf`. See `./maxPfFreeze.ts` for the audit.
 *
 * ## Before the playoffs finish
 *
 * ⚠ AN UNAVAILABLE INPUT PRODUCES A PENDING SLOT WITH A REASON, NEVER A GUESS. Commissioner OS is
 * meant to show a commissioner the order taking shape during the final weeks, and a slot filled by
 * a plausible-looking guess is indistinguishable from a settled one once it is on screen.
 *
 * Pure: roles, outcomes, placements and a frozen snapshot in; slots out. No DB, no clock, no
 * randomness.
 */

import type {
  EflPlayoffOutcome,
  EflTierPlacement,
  EflTierStanding,
  EflTransitionConfig,
} from '@/lib/commissioner-os/efl/types'
import { EFL_DEFAULT_TRANSITION_CONFIG } from '@/lib/commissioner-os/efl/types'
import { resolveEflTierRoles, type EflTierRoles } from '@/lib/commissioner-os/efl/seasonTransitionResolver'
import type { MaxPfFreezeSnapshot, MaxPfFreezeState } from '@/lib/commissioner-os/efl/maxPfFreeze'

/**
 * One slot's rule.
 *
 * ⚠ EVERY VARIANT NAMES A TIER, because the same role exists in several tiers and the published
 * order interleaves them — slot 6 is the League 2 promotion playoff loser and slot 14 is the
 * League 1 one. A rule without a tier could not tell them apart.
 */
export type EflSlotRule =
  /** The nth-lowest frozen value among the teams no structural role claimed. `groupIndex` is 1-based. */
  | { kind: 'reverse_max_pf'; tierLevel: number; groupIndex: number }
  | { kind: 'auto_promoted'; tierLevel: number }
  | { kind: 'auto_relegated'; tierLevel: number }
  | { kind: 'promotion_playoff_winner'; tierLevel: number }
  | { kind: 'promotion_playoff_loser'; tierLevel: number }
  | { kind: 'relegation_playoff_winner'; tierLevel: number }
  | { kind: 'relegation_playoff_loser'; tierLevel: number }
  /** A finishing position from that tier's own championship playoff. `place` is 1-based. */
  | { kind: 'tier_final_placement'; tierLevel: number; place: number }

export type EflDraftSlot = {
  slot: number
  rule: EflSlotRule
  teamId: string | null
  teamName: string | null
  status: 'resolved' | 'pending'
  /** Why the slot cannot be filled yet. Null when resolved. */
  pendingReason: string | null
  /** Which inputs decided it — the audit trail for a commissioner who asks "why am I picking 7th?". */
  provenance: {
    basis: EflSlotRule['kind']
    tierLevel: number
    inputs: string[]
  }
  /** One sentence a human can read. */
  explanation: string
}

export type EflRookieDraftOrderResult = {
  leagueId: string
  /** The season the draft is FOR. */
  season: number
  slots: EflDraftSlot[]
  pendingSlots: number[]
  conflicts: string[]
  /** True only when every slot resolved, there are no conflicts, and no team appears twice. */
  complete: boolean
  /**
   * The freeze state the order was built on.
   *
   * 🛑 SURFACED BECAUSE AN ORDER BUILT ON A `ready` SNAPSHOT IS NOT SETTLED. It is computable and
   * correct today and can move next week. Rendering it beside a `frozen` one without saying which
   * is which is how a commissioner comes to distrust the whole ladder.
   */
  freezeState: MaxPfFreezeState
}

/**
 * The published EFL order, verbatim from the constitution.
 *
 * 🛑 TIER 1 IS THE PREMIER LEAGUE (highest); TIER 4 IS LEAGUE 2 (lowest).
 *
 * Read down the list and the shape is the constitution's intent: the worst teams in the lowest
 * division pick first, then each band walks upward through "the teams that just failed to go up",
 * "the teams that just came down", and "the teams that went up", tier by tier — finishing with the
 * Premier League's own playoff placings in reverse, champion last at 32.
 *
 * ⚠ EIGHT SLOTS PER TIER, AND A TEST ASSERTS IT. Tier 4: five reverse-Max-PF plus three
 * promotion-contenders. Tiers 3 and 2: two reverse-Max-PF plus three promotion- and three
 * relegation-contenders. Tier 1: three relegation-contenders plus five playoff placings.
 */
export const EFL_ROOKIE_DRAFT_ORDER_V1: readonly EflSlotRule[] = Object.freeze([
  /*  1 */ { kind: 'reverse_max_pf', tierLevel: 4, groupIndex: 1 },
  /*  2 */ { kind: 'reverse_max_pf', tierLevel: 4, groupIndex: 2 },
  /*  3 */ { kind: 'reverse_max_pf', tierLevel: 4, groupIndex: 3 },
  /*  4 */ { kind: 'reverse_max_pf', tierLevel: 4, groupIndex: 4 },
  /*  5 */ { kind: 'reverse_max_pf', tierLevel: 4, groupIndex: 5 },
  /*  6 */ { kind: 'promotion_playoff_loser', tierLevel: 4 },
  /*  7 */ { kind: 'auto_relegated', tierLevel: 3 },
  /*  8 */ { kind: 'relegation_playoff_loser', tierLevel: 3 },
  /*  9 */ { kind: 'promotion_playoff_winner', tierLevel: 4 },
  /* 10 */ { kind: 'auto_promoted', tierLevel: 4 },
  /* 11 */ { kind: 'relegation_playoff_winner', tierLevel: 3 },
  /* 12 */ { kind: 'reverse_max_pf', tierLevel: 3, groupIndex: 1 },
  /* 13 */ { kind: 'reverse_max_pf', tierLevel: 3, groupIndex: 2 },
  /* 14 */ { kind: 'promotion_playoff_loser', tierLevel: 3 },
  /* 15 */ { kind: 'auto_relegated', tierLevel: 2 },
  /* 16 */ { kind: 'relegation_playoff_loser', tierLevel: 2 },
  /* 17 */ { kind: 'promotion_playoff_winner', tierLevel: 3 },
  /* 18 */ { kind: 'auto_promoted', tierLevel: 3 },
  /* 19 */ { kind: 'relegation_playoff_winner', tierLevel: 2 },
  /* 20 */ { kind: 'reverse_max_pf', tierLevel: 2, groupIndex: 1 },
  /* 21 */ { kind: 'reverse_max_pf', tierLevel: 2, groupIndex: 2 },
  /* 22 */ { kind: 'promotion_playoff_loser', tierLevel: 2 },
  /* 23 */ { kind: 'auto_relegated', tierLevel: 1 },
  /* 24 */ { kind: 'relegation_playoff_loser', tierLevel: 1 },
  /* 25 */ { kind: 'promotion_playoff_winner', tierLevel: 2 },
  /* 26 */ { kind: 'auto_promoted', tierLevel: 2 },
  /* 27 */ { kind: 'relegation_playoff_winner', tierLevel: 1 },
  /* 28 */ { kind: 'tier_final_placement', tierLevel: 1, place: 5 },
  /* 29 */ { kind: 'tier_final_placement', tierLevel: 1, place: 4 },
  /* 30 */ { kind: 'tier_final_placement', tierLevel: 1, place: 3 },
  /* 31 */ { kind: 'tier_final_placement', tierLevel: 1, place: 2 },
  /* 32 */ { kind: 'tier_final_placement', tierLevel: 1, place: 1 },
])

export type ResolveEflRookieDraftOrderInput = {
  leagueId: string
  /** The season the draft is FOR. */
  season: number
  tiers: readonly EflTierStanding[]
  freeze: MaxPfFreezeSnapshot | null
  freezeState: MaxPfFreezeState
  playoffOutcomes?: readonly EflPlayoffOutcome[]
  /** Championship-playoff placings, for `tier_final_placement` rules. */
  tierPlacements?: readonly EflTierPlacement[]
  config?: EflTransitionConfig
  /** Defaults to the published EFL order. Supplied explicitly for a customised ladder. */
  orderSpec?: readonly EflSlotRule[]
}

type Resolution = { teamId: string | null; inputs: string[]; pendingReason: string | null }

function ruleLabel(rule: EflSlotRule, tierLabel: string): string {
  switch (rule.kind) {
    case 'reverse_max_pf':
      return `${tierLabel} Reverse Max PF #${rule.groupIndex}`
    case 'auto_promoted':
      return `${tierLabel} automatic promotion`
    case 'auto_relegated':
      return `${tierLabel} automatic relegation`
    case 'promotion_playoff_winner':
      return `${tierLabel} promotion playoff winner`
    case 'promotion_playoff_loser':
      return `${tierLabel} promotion playoff loser`
    case 'relegation_playoff_winner':
      return `${tierLabel} relegation playoff winner`
    case 'relegation_playoff_loser':
      return `${tierLabel} relegation playoff loser`
    case 'tier_final_placement':
      return `${tierLabel} playoff finish #${rule.place}`
  }
}

export function resolveEflRookieDraftOrder(
  input: ResolveEflRookieDraftOrderInput,
): EflRookieDraftOrderResult {
  const config = input.config ?? EFL_DEFAULT_TRANSITION_CONFIG
  const spec = input.orderSpec ?? EFL_ROOKIE_DRAFT_ORDER_V1
  const roles = resolveEflTierRoles(input.tiers, config)
  const tierByLevel = new Map(input.tiers.map((t) => [t.tierLevel, t]))
  const nameById = new Map(input.tiers.flatMap((t) => t.teams.map((x) => [x.teamId, x.teamName])))
  const frozenById = new Map((input.freeze?.rows ?? []).map((r) => [r.teamId, r.value]))
  const conflicts: string[] = []

  /**
   * The reverse-Max-PF pool for one tier: unclaimed teams, LOWEST FROZEN VALUE FIRST.
   *
   * ⚠ TIES BREAK ON `teamId`, NOT ON RANK OR INSERTION ORDER. Two teams on identical points is
   * rare but real, and an unstable tiebreak would make the same inputs produce different draft
   * orders across runs — which is the determinism requirement, and it is the kind of thing nobody
   * notices until two commissioners compare screenshots.
   */
  const poolFor = (tierLevel: number, role: EflTierRoles): { teamId: string; value: number }[] =>
    role.unclaimed
      .map((t) => ({ teamId: t.teamId, value: frozenById.get(t.teamId) }))
      .filter((x): x is { teamId: string; value: number } => {
        if (x.value === undefined) {
          conflicts.push(
            `Tier ${tierLevel}: ${nameById.get(x.teamId) ?? x.teamId} has no frozen value, so the Reverse Max PF order for that tier is incomplete.`,
          )
          return false
        }
        return true
      })
      .sort((a, b) => a.value - b.value || (a.teamId < b.teamId ? -1 : 1))

  const poolCache = new Map<number, { teamId: string; value: number }[]>()

  const outcomeFor = (kind: 'promotion' | 'relegation', tierLevel: number) =>
    (input.playoffOutcomes ?? []).find((o) => o.kind === kind && o.tierLevel === tierLevel) ?? null

  const placementFor = (tierLevel: number) =>
    (input.tierPlacements ?? []).find((p) => p.tierLevel === tierLevel) ?? null

  function resolveRule(rule: EflSlotRule): Resolution {
    const role = roles.get(rule.tierLevel)
    if (!role) {
      return { teamId: null, inputs: [], pendingReason: `Tier ${rule.tierLevel} has no standings.` }
    }

    switch (rule.kind) {
      case 'reverse_max_pf': {
        if (!input.freeze) {
          return {
            teamId: null,
            inputs: ['frozen Max PF'],
            pendingReason: 'The regular-season Max PF freeze is not available.',
          }
        }
        if (!poolCache.has(rule.tierLevel)) poolCache.set(rule.tierLevel, poolFor(rule.tierLevel, role))
        const pool = poolCache.get(rule.tierLevel)!
        const picked = pool[rule.groupIndex - 1]
        if (!picked) {
          return {
            teamId: null,
            inputs: ['frozen Max PF'],
            /*
             * ⚠ THIS IS THE LOUD FAILURE THE DERIVED POOL BUYS. A spec asking for the 5th-lowest in
             * a tier that only has two unclaimed teams says the spec and the playoff counts
             * disagree — a real misconfiguration, reported rather than silently leaving a hole.
             */
            pendingReason: `Tier ${rule.tierLevel} has only ${pool.length} team(s) outside a promotion or relegation role; the order asks for #${rule.groupIndex}.`,
          }
        }
        return {
          teamId: picked.teamId,
          inputs: [`frozen Max PF ${picked.value.toFixed(2)}`, `${input.freeze.metric}`],
          pendingReason: null,
        }
      }

      case 'auto_promoted': {
        const t = role.autoPromoted[0]
        return t
          ? { teamId: t.teamId, inputs: [`tier rank ${t.rank}`], pendingReason: null }
          : { teamId: null, inputs: [], pendingReason: `Tier ${rule.tierLevel} promotes nobody.` }
      }

      case 'auto_relegated': {
        const t = role.autoRelegated[0]
        return t
          ? { teamId: t.teamId, inputs: [`tier rank ${t.rank}`], pendingReason: null }
          : { teamId: null, inputs: [], pendingReason: `Tier ${rule.tierLevel} relegates nobody.` }
      }

      case 'promotion_playoff_winner':
      case 'promotion_playoff_loser': {
        const o = outcomeFor('promotion', rule.tierLevel)
        if (!o) {
          return {
            teamId: null,
            inputs: ['promotion playoff result'],
            pendingReason: `The tier ${rule.tierLevel} promotion playoff has no recorded result.`,
          }
        }
        const teamId = rule.kind === 'promotion_playoff_winner' ? o.winnerTeamId : o.loserTeamId
        return { teamId, inputs: ['promotion playoff result'], pendingReason: null }
      }

      case 'relegation_playoff_winner':
      case 'relegation_playoff_loser': {
        const o = outcomeFor('relegation', rule.tierLevel)
        if (!o) {
          return {
            teamId: null,
            inputs: ['relegation playoff result'],
            pendingReason: `The tier ${rule.tierLevel} relegation playoff has no recorded result.`,
          }
        }
        const teamId = rule.kind === 'relegation_playoff_winner' ? o.winnerTeamId : o.loserTeamId
        return { teamId, inputs: ['relegation playoff result'], pendingReason: null }
      }

      case 'tier_final_placement': {
        const p = placementFor(rule.tierLevel)
        if (!p) {
          return {
            teamId: null,
            inputs: ['championship playoff placement'],
            pendingReason: `Tier ${rule.tierLevel} has no recorded playoff placement.`,
          }
        }
        const teamId = p.placements[rule.place - 1] ?? null
        return teamId
          ? { teamId, inputs: [`championship playoff place ${rule.place}`], pendingReason: null }
          : {
              teamId: null,
              inputs: ['championship playoff placement'],
              pendingReason: `Tier ${rule.tierLevel} placement list has no entry for place ${rule.place}.`,
            }
      }
    }
  }

  const slots: EflDraftSlot[] = spec.map((rule, i) => {
    const tierLabel = tierByLevel.get(rule.tierLevel)?.label ?? `Tier ${rule.tierLevel}`
    const r = resolveRule(rule)
    const label = ruleLabel(rule, tierLabel)
    const teamName = r.teamId ? (nameById.get(r.teamId) ?? null) : null

    return {
      slot: i + 1,
      rule,
      teamId: r.teamId,
      teamName,
      status: r.teamId ? 'resolved' : 'pending',
      pendingReason: r.pendingReason,
      provenance: { basis: rule.kind, tierLevel: rule.tierLevel, inputs: r.inputs },
      explanation: r.teamId
        ? `Pick ${i + 1}: ${teamName ?? r.teamId} — ${label}${r.inputs.length ? ` (${r.inputs.join(', ')})` : ''}.`
        : `Pick ${i + 1}: ${label} — not yet decided. ${r.pendingReason ?? ''}`.trim(),
    }
  })

  /*
   * 🛑 A TEAM APPEARING TWICE IS A CONTRADICTION, NOT A DRAFT ORDER. It means two rules claimed the
   * same team — a playoff outcome naming a team that also auto-promoted, or a placement list
   * including a relegated side. The order is unusable, and saying so is the only safe answer.
   */
  const seen = new Map<string, number>()
  for (const s of slots) {
    if (!s.teamId) continue
    const prior = seen.get(s.teamId)
    if (prior !== undefined) {
      conflicts.push(
        `${s.teamName ?? s.teamId} appears at both pick ${prior} and pick ${s.slot}.`,
      )
      continue
    }
    seen.set(s.teamId, s.slot)
  }

  const pendingSlots = slots.filter((s) => s.status === 'pending').map((s) => s.slot)

  return {
    leagueId: input.leagueId,
    season: input.season,
    slots,
    pendingSlots,
    conflicts,
    complete: pendingSlots.length === 0 && conflicts.length === 0 && seen.size === slots.length,
    freezeState: input.freezeState,
  }
}
