import 'server-only'

import { getEligibleDevyPlayers } from '@/lib/devy-classification'
import { buildDevyValueBoard, type DevyBoardInput } from '@/lib/devy/devyValueBoard'
import { resolvePlayers } from '@/lib/shared-services/player-identity/PlayerIdentityResolver'
import type { CanonicalValue, ValueLookup } from './contract'

/**
 * Devy board → {@link CanonicalValue}. Second of the three adapters (2.2).
 *
 * 🛑 THIS IS THE ONLY PRODUCER THAT EMITS `devy_points`, AND THAT IS THE WHOLE REASON THE
 * CONTRACT HAS A `unit` FIELD. `devyValueBoard.ts` prices the board on a curve that "compares
 * devy assets to each other and converts to nothing else", and `devyMarketBridge.ts` refuses to
 * grade a trade spanning both scales because grading it would mean inventing a conversion. If
 * this adapter emitted `market_units`, `sumCanonicalValues` would happily add a college prospect
 * to an NFL running back and nobody would ever see it happen.
 *
 * ── ⚠ DO NOT READ `DevyPlayer.devyValue`. IT IS NOT A VALUATION ─────────────────────────────
 * Verified against production 2026-08-25 and documented at length in `devyValueBoard.ts`: that
 * column is written by a lookup table (`QB 6000 / RB 4500 / WR 5000 / TE 3500` × class-year
 * multiplier) with NO player-specific input, so every freshman quarterback in the country prices
 * at 8,400 — and it is ZERO, not null, for 1,455 of 1,718 players, so 85% of the board renders an
 * absence of data as a confident "worthless". The board ranks on `draftProjectionScore`, the
 * signal that has evidence behind it, and prices that rank on the devy-points curve. This adapter
 * reads the board, never the column.
 *
 * ── IDENTITY: NAME + SCHOOL, BECAUSE NOTHING ELSE REACHES THESE PLAYERS ─────────────────────
 * Measured on production 2026-08-31: `sleeperId` covers 0.0% of NCAAF registry rows, `cfbdId`
 * 7.7% and `fantraxId` 10.2%. The registry's NCAAF population is keyed on (name, team) by
 * `7beaa8811`, which is the path that actually resolves. The resolver has NO fantrax direct-id
 * column, so a `sourceId` here would be dead weight; name + school is not a fallback, it is the
 * route.
 *
 * ⚠ AND `name_match_ambiguous` IS REFUSED, WHICH MATTERS MOST HERE OF ANYWHERE. That same commit
 * measured 4,925 of 7,248 colliding NCAAF names as DIFFERENT PEOPLE at different schools — Ryan
 * Davis is 8 rows across 7 schools. Accepting a tie would attribute one prospect's price to
 * another, and it would never surface as an error.
 */

const SOURCE_MODULE = 'lib/devy/devyValueBoard'

/** Devy prices exist for college football only. NCAAB is paired for C2C but nothing prices it. */
const DEVY_PRICED_SPORTS: ReadonlySet<string> = new Set(['NCAAF'])

export interface DevyAdapterArgs {
  sport: string
  currentSeason: number
  limit?: number
}

/**
 * Corroboration tier → confidence.
 *
 * ⚠ THESE ARE ORDINAL, NOT FITTED, AND SAYING SO IS PART OF THE CONTRACT. The tiers themselves
 * come from a real measured distribution (2026-08-29, 327 players carrying both signals: median
 * rank gap 71, p90 176, overall Spearman 0.380), but nothing has ever fitted a PROBABILITY to
 * them. These three numbers preserve the ordering the evidence supports and claim nothing more.
 *
 * 🛑 NULL STAYS NULL. `corroboration` is null when only one signal exists, and the board's own
 * comment says why: "one opinion cannot corroborate itself and reporting agreement would invent
 * it." With ADP coverage at ~337 of 1,720, most players land here — and a null confidence is the
 * honest answer for them, not a low one. `OsFactEnvelope` draws exactly this distinction.
 */
export function confidenceFromCorroboration(
  tier: 'corroborated' | 'mixed' | 'contested' | null | undefined,
): number | null {
  if (tier == null) return null
  if (tier === 'corroborated') return 0.75
  if (tier === 'mixed') return 0.45
  return 0.2
}

export async function loadDevyValues(args: DevyAdapterArgs): Promise<ValueLookup[]> {
  const sport = args.sport.trim().toUpperCase()

  if (!DEVY_PRICED_SPORTS.has(sport)) {
    return [
      {
        status: 'no_producer',
        sport,
        basis: 'devy_model',
        detail:
          `No devy price exists for ${sport}. The devy board is college FOOTBALL only; ` +
          `NCAAB is paired with NBA for C2C but has no valuation model of any kind.`,
      },
    ]
  }

  /*
   * 🛑 ELIGIBILITY IS NOT OPTIONAL, AND THE FIRST VERSION OF THIS ADAPTER OMITTED IT.
   *
   * It read `devyPlayer.findMany()` with no filter, so it would price players who had graduated
   * to the NFL, players marked not devy-eligible, and anyone not in `league: 'NCAA'` — a devy
   * value for an asset that is no longer a devy asset.
   *
   * ⚠ THE BUG WAS MASKED AND WAS ABOUT TO STOP BEING MASKED. `graduatedToNFL` was true for ZERO
   * of 1,721 rows because `classifyDraftStatus` had no caller. It has one now (`ad514a334`,
   * scheduled on import-players), so the graduated population starts filling from the next draft
   * class — and the adapter would have begun pricing NFL players as prospects with nothing
   * failing. `devyMarketBridge.ts` names this exact hazard: "masked right now only because the
   * table holds forward-looking cohorts".
   *
   * Fixed by calling the EXISTING eligibility rule rather than writing a second one. Two
   * implementations of "who is on the board" is the defect, not the filter.
   */
  const players = await getEligibleDevyPlayers({ limit: args.limit ?? 2000 }).catch(() => [])

  if (players.length === 0) {
    return [
      {
        status: 'not_computed',
        sport,
        basis: 'devy_model',
        detail:
          'No ELIGIBLE devy players. Either the pool is unseeded (/api/cron/import-players, devyPool ' +
          'phase) or every prospect has graduated or been marked ineligible. Not a missing model.',
      },
    ]
  }

  const board = buildDevyValueBoard(players as DevyBoardInput[], args.currentSeason)

  /*
   * Only entries the board could actually price. `DevyAssetValue.value` is documented as "Null
   * when the player is not ranked — never 0", and that refusal has to survive translation: an
   * unranked prospect entering the contract as 0 would price him as the worst asset on the board,
   * which is the exact failure `devyValueBoard` records `DevyPlayer.devyValue` committing.
   */
  const priced = board.entries.filter((e) => e.value?.value != null)

  const resolutions = await resolvePlayers(
    // No sourceId: the resolver has no fantrax direct-id column, so name + school IS the route.
    priced.map((e) => ({
      provider: 'fantrax' as const,
      nameHint: e.name,
      teamHint: e.school,
      positionHint: e.position,
      sport,
    })),
  ).catch(() => [])

  const out: ValueLookup[] = []
  priced.forEach((entry, i) => {
    const res = resolutions[i]
    const canonical = res?.player?.canonicalPlayerId
    if (!canonical || res?.confidence === 'name_match_ambiguous' || res?.confidence === 'unresolved') {
      out.push({
        status: 'unresolved_identity',
        idSpace: 'name+team',
        sourceId: `${entry.name}@${entry.school ?? 'unknown'}`,
        detail:
          `"${entry.name}" (${entry.school ?? 'no school'}) is priced on the board but did not ` +
          `resolve onto the registry (${res?.confidence ?? 'no result'}). Reported rather than ` +
          `dropped — NCAAF is where identity coverage is thinnest and silence would hide it.`,
      })
      return
    }

    const value: CanonicalValue = {
      playerId: canonical,
      idSpace: 'name+team',
      sourceId: `${entry.name}@${entry.school ?? 'unknown'}`,
      sport,
      // ⚠ The name is already the JOIN KEY here (`sourceId` is `name@school`), so carrying it as a
      // display field costs nothing. Keeping the two separate still matters: `sourceId` is how the
      // row was matched and must stay verbatim; `playerName` is what a reader is shown.
      playerName: entry.name ?? null,
      position: null,
      value: entry.value.value!,
      unit: 'devy_points',
      basis: 'devy_model',
      scope: 'global',
      overallRank: entry.devyRank ?? null,
      positionRank: null,
      confidence: confidenceFromCorroboration(entry.corroboration?.confidence ?? null),
      /*
       * How many INDEPENDENT orderings back this price: scouting alone, or scouting corroborated
       * by real drafter behaviour. Literally true and directly useful — a price backed by two
       * signals that agree is a different object from one backed by a single weak signal, and
       * board-level `adpCoverage` (~337 of 1,720) cannot say which a given player is.
       */
      sampleSize: entry.corroboration ? 2 : 1,
      asOf: new Date().toISOString(),
      sourceModule: SOURCE_MODULE,
    }
    out.push({ status: 'ok', value })
  })

  return out
}
