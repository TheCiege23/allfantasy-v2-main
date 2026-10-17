/**
 * THE trade grade, in the shape the AF Legacy page's trade tools print it. PURE.
 *
 * 🛑 THE /af-legacy TRADE TOOLS PRINTED THEIR OWN VERDICTS UNTIL 2026-09-29. The Trade Hub's live
 * preview ("Quick evaluate") showed `computeTradeDrivers`' verdict, fairness delta, a 4-factor
 * score and an acceptance rate; the proposal generator scored its packages "/100" on its own
 * FantasyCalc totals and showed an acceptance model; the goal proposals showed the goal engine's
 * fairness score and acceptance odds; the counter suggestions showed a second engine's verdict,
 * fairness and "Est. Accept"; and the league trade finder printed the LLM's own "A/B/C". Five
 * numbers, none of them the letter the full analyzer on the same page gives the same deal.
 *
 * Now each of them grades through the one grader (`lib/legacy/legacyOneGrade.ts` →
 * `createLeagueTradeGrader` + `gradeDeal`) and prints only what this module hands it: the letter,
 * the mirror letter, the label and recommendation read off the same number, and the league values
 * the letter was taken on. A grade that cannot be taken is WITHHELD with its reason — never
 * replaced by some other model's number.
 *
 * (The league trade finder, `/api/legacy/trade/league-analyze`, was removed on 2026-09-30 rather than
 * graded: it ran a GPT-4o call on every Trade Hub league select and nothing on the page showed it.)
 */
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'

export type LegacyPackageGrade =
  | {
      graded: true
      /** For the side that sends `give` — "you" on every legacy tool. */
      letter: GradeLetter
      /** For the other manager. Always the mirror of `letter`. */
      partnerLetter: GradeLetter
      /** "Even", "Slightly favors you", … — read off the same number as the letter. */
      label: string
      recommendation: string
      /** League value each way: the totals the letter is taken on. */
      giveValue: number
      getValue: number
      /** The chart underneath, in a manager's words. */
      basis: string
    }
  | { graded: false; reason: string }

/** The one grade's view, cut down to what a legacy card prints. Nothing is recomputed. */
export function legacyPackageGrade(view: TradeGradeView): LegacyPackageGrade {
  if (!view.graded) return { graded: false, reason: view.reason }
  return {
    graded: true,
    letter: view.letter,
    partnerLetter: view.partnerLetter,
    label: view.label,
    recommendation: view.recommendation,
    giveValue: view.giveValue,
    getValue: view.getValue,
    basis: view.basis,
  }
}

/**
 * An asset as the trade-engine modules carry it (`lib/trade-engine/types.ts` `Asset`): the goal
 * proposal engine's packages.
 *
 * A player is priced by its VERIFIED provider identity when the engine has one
 * (`valuationIdentity`), and by name otherwise — never by `rosterPlayerId`, which the engine's own
 * type says is not a provider namespace. A pick needs its season and round; one without either, and
 * a FAAB line with no amount, is NAMED as unpriceable rather than dropped, so the deal is withheld
 * instead of graded as though the asset were not in it.
 */
type EngineAssetLike = {
  type: string
  name?: string
  displayName?: string
  valuationIdentity?: { provider: 'sleeper' | 'yahoo'; id: string; position?: string; team?: string }
  pickSeason?: number
  round?: number
  value?: number
  faabAmount?: number
}

export function gradeInputsFromEngineAssets(assets: ReadonlyArray<EngineAssetLike>): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    const type = String(a.type ?? '').toUpperCase()
    if (type === 'PICK') {
      if (a.pickSeason && a.round) {
        out.assets.push({ kind: 'pick', year: a.pickSeason, round: a.round, ...(a.displayName ? { label: a.displayName } : {}) })
      } else {
        out.unpriceable.push(a.displayName || a.name || 'a draft pick with no season or round')
      }
      continue
    }
    if (type === 'FAAB') {
      const amount = typeof a.faabAmount === 'number' && Number.isFinite(a.faabAmount) ? a.faabAmount : null
      if (amount && amount > 0) out.assets.push({ kind: 'faab', amount })
      else out.unpriceable.push('a FAAB amount')
      continue
    }
    const name = a.name?.trim()
    if (!name) {
      out.unpriceable.push('a player with no name')
      continue
    }
    out.assets.push({
      kind: 'player',
      name,
      ...(a.valuationIdentity?.id ? { providerIdentity: a.valuationIdentity } : {}),
    })
  }
  return out
}

/**
 * The proposal generator's roster assets (`{ type: 'player' | 'pick', name, pickYear, pickRound }`).
 * Players go in BY NAME, as the full analyzer on the same page sends them, so the two read one
 * letter for one deal.
 */
export function gradeInputsFromRosterAssets(
  assets: ReadonlyArray<{ type: 'player' | 'pick'; name?: string | null; pickYear?: number | null; pickRound?: number | null }>,
): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    if (a.type === 'pick') {
      if (a.pickYear && a.pickRound) out.assets.push({ kind: 'pick', year: a.pickYear, round: a.pickRound, ...(a.name ? { label: a.name } : {}) })
      else out.unpriceable.push(a.name?.trim() || 'a draft pick with no season or round')
      continue
    }
    const name = a.name?.trim()
    if (name) out.assets.push({ kind: 'player', name })
    else out.unpriceable.push('a player with no name')
  }
  return out
}

/** A grader for one league (see `createLegacyPackageGrader`), injected so this module stays pure. */
export type LegacyPackageGradeFn = (give: GradeInputs, get: GradeInputs) => Promise<LegacyPackageGrade>

/** A counter candidate as the second trade engine names it (`lib/engine/trade.ts` counters' options). */
export type CounterCandidate = { id?: string | null; name?: string | null; pos?: string | null; team?: string | null }

/**
 * The deal a counter leaves on the table: the original deal plus the one asset the counter adds to
 * what you give and/or asks back — exactly what the counter card's "Apply" button puts in the builder
 * (the FIRST candidate of each list). Players by name, as the full analyzer prices them. PURE.
 */
export function appliedCounterInputs(
  base: { give: GradeInputs; get: GradeInputs },
  applied: { addToGive?: CounterCandidate | null; addToGet?: CounterCandidate | null },
): { give: GradeInputs; get: GradeInputs } {
  const plus = (side: GradeInputs, c: CounterCandidate | null | undefined): GradeInputs => {
    if (!c) return side
    const name = c.name?.trim()
    return name
      ? { assets: [...side.assets, { kind: 'player', name }], unpriceable: side.unpriceable }
      : { assets: side.assets, unpriceable: [...side.unpriceable, 'a counter asset with no name'] }
  }
  return { give: plus(base.give, applied.addToGive), get: plus(base.get, applied.addToGet) }
}

export const COUNTER_WITHOUT_ASSET_REASON =
  'This counter is advice, not a specific deal — apply a player to it and the trade grade is taken on the result.'

type EngineCounter = {
  label?: string
  changes?: unknown[]
  whyTheyAccept?: string[]
  whyItHelpsYou?: string[]
  options?: { addCandidates?: CounterCandidate[]; askCandidates?: CounterCandidate[] }
  [key: string]: unknown
}

/**
 * The counter suggestions the legacy analyzer shows (`TradeCounterSuggestions`), each with THE grade of
 * the deal it leaves (`appliedCounterInputs`), and WITHOUT the second engine's `acceptProb` and
 * `fairnessScore` — the "Est. Accept" and "Fairness" the card used to print. A counter that names no
 * asset is withheld with the reason. Never throws.
 */
export async function gradeLegacyCounters(
  counters: ReadonlyArray<EngineCounter> | null | undefined,
  base: { give: GradeInputs; get: GradeInputs },
  gradeOf: LegacyPackageGradeFn,
): Promise<Array<{
  label: string
  changes: unknown[]
  whyTheyAccept: string[]
  whyItHelpsYou: string[]
  options: { addCandidates: CounterCandidate[]; askCandidates: CounterCandidate[] }
  grade: LegacyPackageGrade
}>> {
  return Promise.all(
    (counters ?? []).map(async (c) => {
      const addCandidates = Array.isArray(c.options?.addCandidates) ? c.options!.addCandidates! : []
      const askCandidates = Array.isArray(c.options?.askCandidates) ? c.options!.askCandidates! : []
      let grade: LegacyPackageGrade
      if (addCandidates.length === 0 && askCandidates.length === 0) {
        grade = { graded: false, reason: COUNTER_WITHOUT_ASSET_REASON }
      } else {
        const deal = appliedCounterInputs(base, { addToGive: addCandidates[0], addToGet: askCandidates[0] })
        grade = await gradeOf(deal.give, deal.get).catch((): LegacyPackageGrade => ({ graded: false, reason: 'This deal could not be priced just now.' }))
      }
      return {
        label: String(c.label ?? ''),
        changes: Array.isArray(c.changes) ? c.changes : [],
        whyTheyAccept: Array.isArray(c.whyTheyAccept) ? c.whyTheyAccept : [],
        whyItHelpsYou: Array.isArray(c.whyItHelpsYou) ? c.whyItHelpsYou : [],
        options: { addCandidates, askCandidates },
        grade,
      }
    }),
  )
}
