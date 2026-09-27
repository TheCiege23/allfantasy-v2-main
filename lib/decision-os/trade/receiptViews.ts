/**
 * Read-only views of a `TradeEvaluationReceipt` in the shapes older surfaces already speak, so a
 * surface can move onto the one engine without its clients changing shape at the same time. PURE.
 *
 * 🛑 EVERY NUMBER HERE IS THE RECEIPT'S. Nothing is re-priced, re-banded or defaulted: a withheld
 * grade becomes `null`, never a "Fair" and never a balance built from placeholder values. That is
 * the whole difference from `calculateTradeBalance`, which priced an unknown player at a flat 200.
 */
import type { TradeGradeLine, TradeGradeView } from './tradeGrade'
import type { GradeInputs } from './tradeGradeInputs'

type ReceiptLike = {
  receiptId: string | null
  grade: TradeGradeView
  assets: Array<{ side: 'give' | 'get'; name: string; kind: 'player' | 'pick' | 'faab'; leagueValue: number | null }>
}

export type LegacyVerdict = 'Fair' | 'Slightly favors A' | 'Slightly favors B' | 'Strongly favors A' | 'Strongly favors B'

/** The one grade's label, in the legacy analyzer's words. Side A is the side that sends `give`. */
export function legacyVerdictFromGrade(grade: TradeGradeView): LegacyVerdict | null {
  if (!grade.graded) return null
  switch (grade.label) {
    case 'Major win (you)':
      return 'Strongly favors A'
    case 'Slightly favors you':
      return 'Slightly favors A'
    case 'Even':
      return 'Fair'
    case 'Slightly favors opponent':
      return 'Slightly favors B'
    default:
      return 'Strongly favors B'
  }
}

/**
 * The shape `calculateTradeBalance` returned, drawn from the receipt. Side A RECEIVES `get` and side
 * B receives `give` — the legacy analyzer's orientation. Null when the grade was withheld: a balance
 * over a deal that could not be priced is the thing this replaced.
 */
export function legacyBalanceFromReceipt(receipt: ReceiptLike): {
  sideAValue: number
  sideBValue: number
  difference: number
  percentDiff: number
  verdict: LegacyVerdict
  breakdown: {
    sideA: { players: { name: string; value: number; found: boolean }[]; picks: { desc: string; value: number }[]; total: number }
    sideB: { players: { name: string; value: number; found: boolean }[]; picks: { desc: string; value: number }[]; total: number }
  }
  unknownPlayers: string[]
} | null {
  const g = receipt.grade
  if (!g.graded) return null
  const verdict = legacyVerdictFromGrade(g)!
  const sideOf = (side: 'give' | 'get', total: number) => {
    const assets = receipt.assets.filter((a) => a.side === side)
    return {
      players: assets.filter((a) => a.kind !== 'pick').map((a) => ({ name: a.name, value: a.leagueValue ?? 0, found: a.leagueValue != null })),
      picks: assets.filter((a) => a.kind === 'pick').map((a) => ({ desc: a.name, value: a.leagueValue ?? 0 })),
      total,
    }
  }
  return {
    sideAValue: g.getValue,
    sideBValue: g.giveValue,
    difference: g.getValue - g.giveValue,
    percentDiff: Math.abs(g.percentDiff),
    verdict,
    breakdown: { sideA: sideOf('get', g.getValue), sideB: sideOf('give', g.giveValue) },
    unknownPlayers: [],
  }
}

/** The grade fields a surface returns beside its own payload. `grade: null` + a reason when withheld. */
export function receiptGradeFields(receipt: ReceiptLike): {
  grade: string | null
  partnerGrade: string | null
  gradeLabel: string | null
  gradeWithheld: string | null
  percentDiff: number | null
  /** League value the graded side sends / receives — the totals the letter was taken on. */
  giveValue: number | null
  getValue: number | null
  recommendation: string | null
  gradeSource: 'one_trade_engine'
  evaluationReceiptId: string | null
} {
  const g = receipt.grade
  return {
    grade: g.graded ? g.letter : null,
    partnerGrade: g.graded ? g.partnerLetter : null,
    gradeLabel: g.graded ? g.label : null,
    gradeWithheld: g.graded ? null : g.reason,
    percentDiff: g.graded ? g.percentDiff : null,
    giveValue: g.graded ? g.giveValue : null,
    getValue: g.graded ? g.getValue : null,
    recommendation: g.graded ? g.recommendation : null,
    gradeSource: 'one_trade_engine',
    evaluationReceiptId: receipt.receiptId,
  }
}

/**
 * Everything a page may show beside the letter, from the receipt's grade fields ALONE. Nothing here
 * can disagree with the letter: the totals are the ones it was taken on, and the headline is its own
 * recommendation. A missing or withheld grade yields no totals at all — never zeros, which would read
 * as "worthless".
 */
export function liveGradePanel(fields: {
  grade: string | null
  partnerGrade: string | null
  gradeLabel: string | null
  gradeWithheld: string | null
  percentDiff: number | null
  giveValue: number | null
  getValue: number | null
  recommendation: string | null
} | null | undefined): {
  senderGrade: string | null
  receiverGrade: string | null
  gradeLabel: string | null
  gradeWithheld: string | null
  totals: { send: number; get: number; gapPct: number } | null
  headline: string
} {
  if (!fields) {
    const why = 'The grade could not be computed for this trade.'
    return { senderGrade: null, receiverGrade: null, gradeLabel: null, gradeWithheld: why, totals: null, headline: `Not graded. ${why}` }
  }
  const graded = fields.grade != null && fields.giveValue != null && fields.getValue != null && fields.percentDiff != null
  if (!graded) {
    const why = fields.gradeWithheld ?? 'The grade could not be computed for this trade.'
    return { senderGrade: null, receiverGrade: null, gradeLabel: null, gradeWithheld: why, totals: null, headline: `Not graded. ${why}` }
  }
  return {
    senderGrade: fields.grade,
    receiverGrade: fields.partnerGrade,
    gradeLabel: fields.gradeLabel,
    gradeWithheld: null,
    totals: { send: fields.giveValue!, get: fields.getValue!, gapPct: fields.percentDiff! },
    headline: fields.recommendation ?? fields.gradeLabel ?? '',
  }
}

/** The receipt's lines in one sentence each, for a prompt that must explain the grade and not invent one. */
export function receiptPromptBlock(receipt: ReceiptLike): string {
  const g = receipt.grade
  if (!g.graded) {
    return [
      '--- TRADE GRADE (MANDATORY) ---',
      `This trade is NOT graded: ${g.reason}`,
      'Do not assign a letter grade and do not estimate a value for any asset that could not be priced. Explain what is known and what is missing.',
      '--- END TRADE GRADE ---',
    ].join('\n')
  }
  const line = (l: TradeGradeLine) =>
    `  - ${l.name}: ${l.leagueValue != null ? Math.round(l.leagueValue) : 'unpriced'} league value${l.marketValue != null && l.marketValue !== l.leagueValue ? ` (market ${Math.round(l.marketValue)})` : ''}`
  return [
    '--- TRADE GRADE (MANDATORY) ---',
    `AllFantasy's trade engine graded this deal on ${g.basis} league values: grade=${g.letter} for Team A, ${g.partnerLetter} for Team B ("${g.label}", ${g.percentDiff > 0 ? '+' : ''}${g.percentDiff}%).`,
    `Team A receives ${g.getValue} and sends ${g.giveValue}.`,
    'Team A receives:',
    ...g.lines.filter((l) => l.side === 'get').map(line),
    'Team A sends:',
    ...g.lines.filter((l) => l.side === 'give').map(line),
    'This grade is FINAL and is what the user will see. Explain why the values support it — do NOT argue for a different grade or re-price any asset.',
    '--- END TRADE GRADE ---',
  ].join('\n')
}

/** A legacy-analyzer asset (`{type:'player'|'pick'|'faab', …}`) as engine input. */
export function gradeInputsFromLegacyAssets(
  assets: ReadonlyArray<
    | { type: 'player'; player: { name?: string | null } }
    | { type: 'pick'; pick: { year?: number | null; round?: number | null; pickNumber?: number | null } }
    | { type: 'faab'; faab: { amount?: number | null } }
  >,
  numTeams: number,
): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    if (a.type === 'player') {
      const name = a.player?.name?.trim()
      if (name) out.assets.push({ kind: 'player', name })
      else out.unpriceable.push('a player with no name')
    } else if (a.type === 'pick') {
      const { year, round, pickNumber } = a.pick ?? {}
      if (!year || !round) {
        out.unpriceable.push('a draft pick with no year or round')
        continue
      }
      const third = Math.max(1, numTeams / 3)
      const tier = pickNumber ? (pickNumber <= third ? 'early' : pickNumber <= third * 2 ? 'mid' : 'late') : undefined
      out.assets.push({ kind: 'pick', year, round, ...(tier ? { tier } : {}) })
    } else if (a.type === 'faab') {
      const amount = a.faab?.amount
      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) out.assets.push({ kind: 'faab', amount })
      else out.unpriceable.push('a FAAB amount')
    }
  }
  return out
}
