/**
 * The route's single entry point into the Decision OS envelope.
 *
 * 🛑 ONE CALL, SO THE ROUTE DOES NOT GROW ANOTHER SECTION. `app/api/chat/chimmy/route.ts`
 * is 3,100 lines because every capability so far arrived as another inline block.
 * The orchestration lives in `lib/decision-os/envelope/orchestrate.ts`; this
 * adapts the route's existing shapes into it and hands back one string.
 *
 * ⚠ THE SPECIALTY CONTEXT PROVIDERS ARE NOT REPLACED. The fifteen
 * `build*ContextForChimmy` blocks still run and still append; this sits in front
 * of them as the frame they are read against, exactly as the rule grounding did.
 * Migrating them into the packet is a later step, and dropping them now to look
 * tidy would silently lose contexts that work today.
 */

import 'server-only'

import type { ChimmyLeagueSnapshot } from '@/lib/chimmy/chimmy-league-snapshot'
import { resolveLeagueRules } from '@/lib/league-rules'
import { orchestrateInformationalAnswer } from '@/lib/decision-os/envelope/orchestrate'
import { describeAction } from '@/lib/decision-os/envelope/actionCapability'
import type { DecisionOsResult } from '@/lib/decision-os/envelope/orchestrate'
import type { EnvelopeFact } from '@/lib/decision-os/envelope/types'
import { prisma } from '@/lib/prisma'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/dynastyFamily'
import { resolveNativePickYears } from '@/lib/league-trade-engine/nativePickYears'

/**
 * League rules as envelope facts.
 *
 * ⚠ EVERY FACT CARRIES `basis: 'provider_reported'` ONLY WHEN THE LEAGUE ROW
 * ACTUALLY SAID SO. A value that is the schema default is `inferred`, because
 * "the column holds 3" and "the commissioner chose 3" are different claims —
 * the distinction `resolveLeagueRules` exists to preserve, and it would be
 * thrown away by stamping everything as reported.
 */
function rulesAsFacts(snapshot: ChimmyLeagueSnapshot, now: Date): EnvelopeFact[] {
  const resolved = resolveLeagueRules({
    leagueType: snapshot.leagueType,
    isDynasty: snapshot.isDynasty,
    keeperCount: snapshot.keeperCount,
    keeperCostSystem: snapshot.keeperCostSystem,
    keeperRoundPenalty: snapshot.keeperRoundPenalty,
    settings: snapshot.settings,
    sport: snapshot.sport,
  })

  const observedAt = snapshot.lastSyncedAt?.toISOString() ?? null
  const facts: EnvelopeFact[] = []

  if (resolved.concept) {
    facts.push({
      key: 'league.format',
      label: 'Format',
      value: resolved.concept.label,
      citation: {
        source: 'league_rules',
        reference: null,
        observedAt,
        retrievedAt: now.toISOString(),
        basis: 'provider_reported',
      },
      stale: false,
    })
    facts.push({
      key: 'league.pricingBase',
      label: 'Pricing base format',
      value: resolved.pricingBaseFormat,
      citation: {
        source: 'league_rules',
        reference: null,
        observedAt,
        retrievedAt: now.toISOString(),
        basis: 'calculated',
      },
      stale: false,
    })
  }

  for (const [key, rule, label] of [
    ['league.keeper.max', resolved.keeper.maxKeepers, 'Max keepers'],
    ['league.keeper.costSystem', resolved.keeper.costSystem, 'Keeper cost system'],
  ] as const) {
    if (rule.provenance === 'unknown') continue
    facts.push({
      key,
      label,
      value: rule.value,
      citation: {
        source: 'league_settings',
        reference: null,
        observedAt,
        retrievedAt: now.toISOString(),
        /*
         * ⚠ A SCHEMA DEFAULT IS `inferred`, NOT `provider_reported`. Nobody is
         * known to have chosen it, and `provider_reported` would say they had.
         */
        basis: rule.provenance === 'league_setting' ? 'provider_reported' : 'inferred',
      },
      stale: false,
    })
  }

  return facts
}

/**
 * How many seasons ahead this league's draft picks can be traded — the horizon the trade engine offers
 * native picks over (`resolveNativePickYears` on `DynastyLeagueConfig.futurePicksYearsOut`, the Draft Pick
 * Settings tab). A dynasty-family league that plays on AllFantasy and allows pick trading only: an
 * import's horizon is its platform's, and a league with pick trading off has none to state.
 *
 * A stored value is `provider_reported`; no config row (or no value) is the engine's default of 3 and is
 * `inferred`, for the reason `rulesAsFacts` gives. A failed read adds no fact rather than guess one.
 */
async function pickTradeYearsFacts(snapshot: ChimmyLeagueSnapshot, now: Date): Promise<EnvelopeFact[]> {
  if (String(snapshot.platform ?? '').trim().toLowerCase() !== 'manual') return []
  if (!isDynastyFamilyLeague({ leagueType: snapshot.leagueType, isDynasty: snapshot.isDynasty })) return []
  try {
    const [league, dynasty] = await Promise.all([
      prisma.league.findUnique({ where: { id: snapshot.id }, select: { draftPickTrading: true } }),
      prisma.dynastyLeagueConfig.findUnique({ where: { leagueId: snapshot.id }, select: { futurePicksYearsOut: true } }),
    ])
    if (!league || league.draftPickTrading === false) return []
    const stored = dynasty?.futurePicksYearsOut
    return [
      {
        key: 'league.picks.tradeYears',
        label: 'Seasons ahead draft picks can be traded',
        value: resolveNativePickYears(stored),
        citation: {
          source: 'league_settings',
          reference: null,
          observedAt: null,
          retrievedAt: now.toISOString(),
          basis: stored == null ? 'inferred' : 'provider_reported',
        },
        stale: false,
      },
    ]
  } catch {
    return []
  }
}

/**
 * Build the envelope block for the prompt.
 *
 * Returns null only when there is no authorized league AND no refusal to
 * report — the caller then adds nothing, which is correct for a global question.
 */
export async function buildDecisionEnvelopeGrounding(args: {
  message: string
  userId: string | null
  snapshot: ChimmyLeagueSnapshot | null
  orchestrationIntent?: string | null
  sportHint?: string | null
  traceId?: string
  now?: Date
}): Promise<{ promptBlock: string; partial: boolean; clientPayload: Record<string, unknown> } | null> {
  const now = args.now ?? new Date()

  /*
   * 🛑 THE CANDIDATE IS BUILT FROM THE AUTHORIZED SNAPSHOT, NEVER A REQUEST
   * FIELD. The resolver will authorize it again — it has no way to know an id
   * was already checked, and should not be given one. Passing the snapshot's id
   * means the worst case is a redundant membership read, not a trusted claim.
   */
  const candidates = args.snapshot
    ? ([{ id: args.snapshot.id, source: 'explicit_request' }] as const)
    : ([] as const)

  const result = await orchestrateInformationalAnswer({
    context: {
      message: args.message,
      userId: args.userId,
      candidates: [...candidates],
      orchestrationIntent: args.orchestrationIntent ?? null,
      sportHint: args.sportHint ?? null,
    },
    traceId: args.traceId,
    now,
    decisionOs: async (ctx) => {
      if (!ctx.league || !args.snapshot) return {}
      const os: DecisionOsResult = {
        facts: [...rulesAsFacts(args.snapshot, now), ...(await pickTradeYearsFacts(args.snapshot, now))],
        /*
         * ⚠ NO RECOMMENDATION FROM HERE. This adapter reports league RULES; the
         * engines that recommend run elsewhere on the route and have not been
         * migrated. Emitting one would be this module inventing a conclusion,
         * which is the one thing the envelope forbids.
         */
        recommendation: null,
        actions: [
          describeAction({ id: 'submit_trade', label: 'Submit a trade', league: ctx.league }),
          describeAction({ id: 'submit_waiver_claim', label: 'Submit a waiver claim', league: ctx.league }),
          describeAction({ id: 'set_lineup', label: 'Set your lineup', league: ctx.league }),
        ],
      }
      return os
    },
  })

  const hasContent =
    result.envelope.league !== null ||
    result.envelope.refusals.length > 0 ||
    result.envelope.evidenceGaps.length > 0
  if (!hasContent) return null

  return {
    promptBlock: result.promptBlock,
    partial: result.partial,
    clientPayload: result.clientPayload,
  }
}
