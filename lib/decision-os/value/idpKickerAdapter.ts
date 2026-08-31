import 'server-only'

import { buildIdpKickerValueMap, type IdpLeagueValuationContext } from '@/lib/idp-kicker-values'
import { resolvePlayers } from '@/lib/shared-services/player-identity/PlayerIdentityResolver'
import type { CanonicalValue, ValueLookup } from './contract'

/**
 * IDP + kicker values → {@link CanonicalValue}. Third and last of the adapters (2.2).
 *
 * ── 🛑 ONE ADAPTER FOR TWO POSITIONS, ON PURPOSE ────────────────────────────────────────────
 * D3 said "four producers", and building four would have been wrong. `lib/idp-kicker-values.ts`
 * ALREADY composes both: `buildIdpKickerValueMap` takes `vorpBySleeperId` (from
 * `leagueIdpVorp.buildIdpValuations`) and `kickerValue` (from `resolveLeagueKickerValue`) and
 * emits one map. Writing separate IDP and kicker adapters would create two rivals to a module
 * that already unifies them — the mistake §2.14 records making about the waiver resolvers, where
 * "two independent implementations" turned out to be one calling the other.
 *
 * So this adapter wraps the composition and does not reach past it into either producer.
 *
 * ── ⚠ THE FIELD TRAP, WHICH WOULD HAVE PRICED EVERY REDRAFT IDP LEAGUE AT ZERO ──────────────
 * `PlayerValueMap` carries BOTH `value` and `redraftValue`, and `buildIdpKickerValueMap` writes
 * the real number into ONE of them and a literal `0` into the other:
 *
 *     value:        isDynasty ? value : 0
 *     redraftValue: isDynasty ? 0     : value
 *
 * Reading `.value` unconditionally — the obvious thing to write — yields **0 for every IDP and
 * kicker in every redraft league**, and 0 is a legitimate number that `isCoherentValue` accepts.
 * Every defender would silently price as worthless, exactly the failure `devyValueBoard` records
 * `DevyPlayer.devyValue` committing on 1,455 rows. `pickValue()` below is the whole mitigation
 * and must not be inlined away.
 *
 * ── SCOPE: league, ALWAYS ───────────────────────────────────────────────────────────────────
 * Both numbers are derived from one league's own rules — `resolveLeagueIdpScoring` for defenders,
 * `resolveLeagueKickerValue` for kickers. A linebacker projected at 9.06 tackles is worth ~9
 * points under `balanced` scoring and roughly double under a tackle-heavy setup. Emitting these
 * as `scope: 'global'` would price one league's defenders for everybody, which is why
 * `contract.ts` documents scope as deciding cacheability rather than being cosmetic.
 *
 * ⚠ AND THAT IS ALSO WHY THIS ADAPTER DOES NOT RESCORE (2.4). `buildIdpKickerValueMap` takes the
 * league context as an ARGUMENT, so the caller supplies the rules and the value comes back
 * already correct for that league. There is no canonical row here to rescore at read — the
 * `af-projections/rescoreForLeague` pattern applies where one stored snapshot must serve many
 * leagues, and this producer does not store one.
 */

const SOURCE_MODULE = 'lib/idp-kicker-values#buildIdpKickerValueMap'

/** IDP is football-only, and the repo already says so: `IDP_SUPPORTED_SPORTS = ['NFL','NCAAF']`. */
const IDP_KICKER_SPORTS: ReadonlySet<string> = new Set(['NFL', 'NCAAF'])

export interface IdpKickerAdapterArgs {
  sport: string
  leagueId: string
  /** Roster player ids (Sleeper) to price. The caller bounds the fan-out; this never truncates. */
  rosterPlayerIds: string[]
  isDynasty: boolean
  /** VORP and kicker value for THIS league. Absent members mean that half is simply not priced. */
  leagueContext?: IdpLeagueValuationContext | null
}

/**
 * Read whichever field actually holds the number for this league's format.
 *
 * See the header. Returns null rather than 0 when neither is populated, because "not priced" and
 * "priced at zero" are different claims and only one of them is ever true here.
 */
export function pickValue(
  row: { value: number; redraftValue: number },
  isDynasty: boolean,
): number | null {
  const v = isDynasty ? row.value : row.redraftValue
  if (!Number.isFinite(v) || v <= 0) return null
  return v
}

/** `position` on the map is already normalised to 'LB' | 'DL' | 'DB' | 'K' by the producer. */
function basisFor(position: string): 'vorp' | 'share_at_rank' {
  return position === 'K' ? 'share_at_rank' : 'vorp'
}

export async function loadIdpKickerValues(args: IdpKickerAdapterArgs): Promise<ValueLookup[]> {
  const sport = args.sport.trim().toUpperCase()

  if (!IDP_KICKER_SPORTS.has(sport)) {
    return [
      {
        status: 'no_producer',
        sport,
        basis: 'vorp',
        detail:
          `Neither IDP nor kicker values exist for ${sport}. Both are football concepts — ` +
          `IDP_SUPPORTED_SPORTS is ['NFL','NCAAF'] and kickers do not exist outside football.`,
      },
    ]
  }

  if (args.rosterPlayerIds.length === 0) {
    return [
      {
        status: 'not_computed',
        sport,
        basis: 'vorp',
        detail: 'No roster player ids supplied; this producer prices a roster, not a global board.',
      },
    ]
  }

  const map = await buildIdpKickerValueMap(args.rosterPlayerIds, args.isDynasty, args.leagueContext).catch(
    () => new Map<string, { sleeperId: string; value: number; redraftValue: number; position: string; name: string }>(),
  )

  if (map.size === 0) {
    return [
      {
        status: 'not_computed',
        sport,
        basis: 'vorp',
        detail:
          'The value map came back empty. Either this roster holds no IDP or kicker positions, or ' +
          'the league supplied no VORP and no kicker value — in which case those halves are ' +
          'deliberately left unpriced rather than given a made-up number.',
      },
    ]
  }

  const rows = [...map.values()]
  const resolutions = await resolvePlayers(
    rows.map((r) => ({ provider: 'sleeper' as const, sourceId: r.sleeperId, nameHint: r.name, positionHint: r.position, sport })),
  ).catch(() => [])

  const out: ValueLookup[] = []
  rows.forEach((row, i) => {
    const priced = pickValue(row, args.isDynasty)
    if (priced == null) {
      // Not an identity problem and not a missing model — this league does not price him.
      out.push({
        status: 'not_computed',
        sport,
        basis: basisFor(row.position),
        detail: `${row.name} (${row.position}) carries no ${args.isDynasty ? 'dynasty' : 'redraft'} value in this league.`,
      })
      return
    }

    const res = resolutions[i]
    const canonical = res?.player?.canonicalPlayerId
    if (!canonical || res?.confidence === 'name_match_ambiguous' || res?.confidence === 'unresolved') {
      out.push({
        status: 'unresolved_identity',
        idSpace: 'sleeperId',
        sourceId: row.sleeperId,
        detail: `"${row.name}" priced at ${priced} but not resolved onto the registry (${res?.confidence ?? 'no result'}).`,
      })
      return
    }

    const value: CanonicalValue = {
      playerId: canonical,
      idSpace: 'sleeperId',
      sourceId: row.sleeperId,
      sport,
      value: priced,
      unit: 'market_units',
      basis: basisFor(row.position),
      scope: 'league',
      leagueId: args.leagueId,
      positionRank: null,
      overallRank: null,
      /*
       * ⚠ NULL, DELIBERATELY, AND NOT BECAUSE IT WAS FORGOTTEN. Neither producer expresses a
       * confidence. For kickers that absence IS the finding: `publishedValueEvidence.ts` measured
       * kicker rank year-over-year as NEGATIVE in all six season pairs (2019-2025, n=4,482), which
       * is why every kicker in a league gets the same number and no rank is read. Inventing a
       * confidence here would dress that honesty up as a measurement.
       */
      confidence: null,
      sampleSize: null,
      asOf: new Date().toISOString(),
      sourceModule: SOURCE_MODULE,
    }
    out.push({ status: 'ok', value })
  })

  return out
}
