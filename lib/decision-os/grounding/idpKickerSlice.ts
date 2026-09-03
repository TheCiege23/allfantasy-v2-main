import 'server-only'

import { prisma } from '@/lib/prisma'
import { detectIdpLeague, detectKickerLeague, type IdpLeagueValuationContext } from '@/lib/idp-kicker-values'
import { loadLeagueIdpVorp } from '@/lib/idp-projections/leagueIdpVorp'
import { resolveLeagueKickerValue } from '@/lib/kicker-values/leagueKickerValue'
import { loadIdpKickerValues } from '../value/idpKickerAdapter'
import type { ValueLookup } from '../value/contract'
import type { GroundedSlice, GroundingGap } from './packet'

/**
 * R3.1 — the IDP + kicker value slice. The half of Player Value OS that had an adapter and no way
 * to reach a prompt.
 *
 * ── 🛑 THE ADAPTER WAS COMPLETE; THE CONTEXT IT NEEDS HAD NO PRODUCER ───────────────────────
 * `loadIdpKickerValues` has been finished and careful for some time, but it takes an
 * `IdpLeagueValuationContext`, and NOTHING IN THE REPO BUILT ONE — a grep for the type found only
 * the adapter and its own definition. Passing `null` compiles and yields an empty value map, which
 * the adapter honestly reports as `not_computed`, forever, for every league. Wiring it that way
 * would have been the `ingestCFBDStats` failure again: a surface pointed at a producer nothing
 * feeds, failing silently and looking correct.
 *
 * So this module builds the context, from the same two pure functions three other modules already
 * compose (`waiver-intelligence`, `idpChimmy`, `league-rankings-v2` all do
 * `{ vorpBySleeperId: idpVorp.vorpBySleeperId }`). It is a fourth caller of an established
 * composition, not a rival to it.
 *
 * ── ⚠ ROSTER-SCOPED AND UNCACHED, WHICH IS WHY IT IS NOT A FEED SOURCE ──────────────────────
 * `marketValueSource` and `devyValueSource` are keyed sport+format and live in the domain-os
 * store. These values cannot: they are derived from ONE league's scoring rules and priced over ONE
 * roster. The adapter's own header makes the point — a linebacker is worth ~9 points under
 * `balanced` scoring and roughly double under a tackle-heavy setup, so emitting them globally
 * would price one league's defenders for everybody. A league-keyed cache would be wrong in the
 * same way a viewer-scoped one leaks.
 *
 * ── ✅ THE CHEAP EXIT IS THE POINT, NOT AN OPTIMISATION ─────────────────────────────────────
 * Measured in `availablePlayersTool`: **10 of 94 NFL leagues carry real IDP roster slots and 19
 * carry a kicker.** So for roughly four leagues in five this slice must cost nothing at all, and
 * `detectIdpLeague` / `detectKickerLeague` are checked BEFORE any query runs. An earlier note in
 * that file claimed 70 of 94, from a grep that matched the SCORING block — every Sleeper league
 * ships `sack`/`int`/`ff` keys whether or not it rosters defenders. Use the strict predicates;
 * never infer an IDP league from its scoring settings.
 */

function absent(gap: GroundingGap): GroundedSlice<ValueLookup[]> {
  return { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap }
}

/**
 * Why an empty VORP map is empty, in words a reader can act on.
 *
 * ⚠ `loadLeagueIdpVorp` RETURNS ITS OWN REASON and it would be a waste to discard it. "The league
 * has no scoring settings" and "nobody rosters a defender" are different problems with different
 * remedies, and collapsing them to "unavailable" is what makes a gap useless.
 */
function vorpSkipDetail(skipped: string | null): string {
  switch (skipped) {
    case 'no_scoring_settings':
      return 'This league has no stored scoring settings, so defenders cannot be valued against replacement.'
    case 'not_an_idp_league':
      return 'This league does not roster IDP positions.'
    case 'no_rostered_defenders':
      return 'No defenders are rostered here, so there is nothing to price.'
    default:
      return skipped ? `The IDP valuation stopped: ${skipped}.` : 'The IDP valuation produced no rows.'
  }
}

/**
 * Sleeper ids off the graded roster slice — starters and bench, deduped.
 *
 * 🛑 `RosterPlayerLite.playerId` IS THE PROVIDER'S ID, NOT A CANONICAL ONE, and that is what makes
 * this safe to hand to a `sleeperId`-keyed query. `RosterContextProvider` reads
 * `Roster.playerData`, which stores provider ids deliberately; only the NAMES are enriched from the
 * canonical registry.
 *
 * ⚠ SO THIS IS CORRECT FOR SLEEPER AND SILENT FOR OTHER PLATFORMS. An MFL or Yahoo roster yields
 * that platform's ids, `loadLeagueIdpVorp` matches none of them against `SportsPlayer.sleeperId`,
 * and the slice reports `no_rostered_defenders` — an honest gap, but one whose WORDING understates
 * the cause. It is a real limit rather than a bug, and worth naming here so the next reader does
 * not spend an hour on "why does this league have no defenders".
 */
export function rosterSleeperIdsFrom(sliceValue: unknown): string[] {
  if (!sliceValue || typeof sliceValue !== 'object') return []
  const v = sliceValue as { starters?: unknown; bench?: unknown }
  const out = new Set<string>()
  for (const group of [v.starters, v.bench]) {
    if (!Array.isArray(group)) continue
    for (const p of group) {
      const id = (p as { playerId?: unknown } | null)?.playerId
      if (typeof id === 'string' && id) out.add(id)
    }
  }
  return [...out]
}

/**
 * `roster_positions` off the canonical rules. Typed `unknown` on `CanonicalLeagueRules.roster`,
 * so it is narrowed here rather than trusted.
 */
export function rosterPositionsFrom(rules: unknown): string[] {
  const r = (rules ?? null) as { roster?: { starters?: unknown } } | null
  const raw = r?.roster?.starters
  if (!Array.isArray(raw)) return []
  return raw.map((x) => String(x)).filter(Boolean)
}

export interface IdpKickerSliceArgs {
  sport: string
  leagueId?: string | null
  /** Sleeper ids to price. The CALLER bounds this — the adapter never truncates. */
  rosterPlayerIds: readonly string[]
  /** `roster_positions` exactly as the platform stated them. */
  rosterPositions: readonly string[] | null | undefined
  numTeams: number
  isDynasty: boolean
}

export async function loadIdpKickerValueSlice(args: IdpKickerSliceArgs): Promise<GroundedSlice<ValueLookup[]>> {
  const sport = (args.sport ?? '').trim().toUpperCase()
  const leagueId = args.leagueId ?? null

  if (!leagueId) {
    return absent({
      reason: 'not_requested',
      detail: 'IDP and kicker values are priced per league, and no league was in scope.',
      remedy: 'Ask about a specific league and they are included.',
    })
  }

  const positions = args.rosterPositions ?? []
  const hasIdp = detectIdpLeague([...positions].map(String))
  const hasKicker = detectKickerLeague([...positions].map(String))

  /*
   * ✅ THE CHEAP EXIT. Four leagues in five stop here, before a single query. This is checked on
   * ROSTER SLOTS rather than scoring keys — see the header on why the scoring-block grep is wrong.
   */
  if (!hasIdp && !hasKicker) {
    return absent({
      reason: 'no_producer',
      detail: 'This league rosters neither IDP positions nor a kicker, so neither is priced.',
      remedy: 'Nothing to fix — these values only exist for leagues that start those positions.',
    })
  }

  if (args.rosterPlayerIds.length === 0) {
    return absent({
      reason: 'not_synced',
      detail: 'No rostered players are known for this league yet, and this prices a roster rather than a global board.',
      remedy: 'Import or re-sync the league so its rosters are known.',
    })
  }

  try {
    /*
     * ⚠ EACH HALF IS BUILT ONLY IF THE LEAGUE ACTUALLY USES IT, and an absent half is left ABSENT
     * rather than zeroed. `IdpLeagueValuationContext` documents both members as optional, meaning
     * "this caller does not price that half" — and the adapter then omits those players entirely
     * instead of giving them a made-up number.
     */
    let vorpSkipped: string | null = null
    let vorpBySleeperId: ReadonlyMap<string, number | null> | undefined

    if (hasIdp) {
      const idpVorp = await loadLeagueIdpVorp({
        prisma,
        isDynasty: args.isDynasty,
        leagueId,
        rosterPositions: positions,
        rosterPlayerIds: args.rosterPlayerIds,
        numTeams: args.numTeams,
      })
      vorpSkipped = idpVorp.skipped ?? null
      // The established guard, copied from the three modules that already do this: an EMPTY map
      // must be passed as `undefined`, not as an empty Map, or the adapter treats it as "priced".
      if (idpVorp.vorpBySleeperId.size > 0) vorpBySleeperId = idpVorp.vorpBySleeperId
    }

    const kickerValue = hasKicker
      ? resolveLeagueKickerValue({ rosterPositions: positions, numTeams: args.numTeams, isDynasty: args.isDynasty }).value
      : null

    const leagueContext: IdpLeagueValuationContext | null =
      vorpBySleeperId || kickerValue != null ? { vorpBySleeperId, kickerValue } : null

    if (!leagueContext) {
      /*
       * Both halves came back unpriceable. Report WHICH, using the loader's own reason — "no
       * scoring settings" and "no rostered defenders" have different remedies.
       */
      return absent({
        reason: vorpSkipped === 'no_scoring_settings' ? 'not_synced' : 'not_computed',
        detail: hasIdp ? vorpSkipDetail(vorpSkipped) : 'This league prices no kicker.',
        remedy:
          vorpSkipped === 'no_scoring_settings'
            ? 'Re-sync the league so its scoring settings are stored.'
            : 'It fills once the league has projections for the positions it starts.',
      })
    }

    const rows = await loadIdpKickerValues({
      sport,
      leagueId,
      rosterPlayerIds: [...args.rosterPlayerIds],
      isDynasty: args.isDynasty,
      leagueContext,
    })

    if (rows.length === 0) {
      return absent({
        reason: 'not_computed',
        detail: 'The IDP/kicker producer returned no rows for this roster.',
        remedy: 'It fills once this league has projections for the positions it starts.',
      })
    }

    return {
      present: true,
      value: rows,
      /*
       * ⚠ COMPUTED FOR THIS REQUEST, NEVER SERVED WARM. These are league-and-roster scoped, so
       * there is no store entry behind them and `live` is the only honest answer.
       */
      servedFrom: 'live',
      asOf: null,
      // Neither producer expresses a confidence — see the adapter, where that absence is itself a
      // finding for kickers. Inventing one here would dress it up as a measurement.
      confidence: null,
      conclusive: { ok: true },
      gap: null,
    }
  } catch (err) {
    return absent({
      reason: 'not_computed',
      detail: `IDP/kicker valuation failed: ${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}`,
      remedy: 'It runs again on the next request.',
    })
  }
}
