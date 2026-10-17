/**
 * THE grade on a league chat trade card (2026-09-27). PURE AND BROWSER-SAFE — `TradeCardView` imports
 * the type and the line, and both writers (`chimmyTradeMoment.ts`, `tradeChatCards.ts`) the take.
 *
 * 🛑 THE CARD'S VERDICT USED TO BE A PRIVATE SCALE. Chimmy's take (`chimmyTradeTake.ts`) priced both
 * sides on raw FantasyCalc market values and chose how hard to call the win from
 * `letterGradeFromScore(tradeScore(...))` — a letter no other screen uses — so the chat could say
 * "Casey wins this one, and it isn't close" about a trade every other surface graded Casey a D. Now,
 * whenever the one grade can be read, the card carries both teams' letters and the message is worded
 * FROM them. The market take remains only for a trade that has no grade at all to read.
 */
import { gradeMoment, type GradeMomentInput } from '@/lib/decision-os/trade/gradeMoment'

export type TradeCardGrade =
  | {
      graded: true
      /** `manager`'s letter — the card's first side. */
      letter: string
      /** The partner's letter. Always the mirror of `letter`. */
      partnerLetter: string
      /**
       * 'today' = on the league's values now; 'at-proposal' = frozen into the trade's receipt when
       * proposed; 'first-graded' = a completed trade's frozen original, taken when AllFantasy first
       * graded it (`frozenCompletedGrade.ts`), with `frozenAt` saying when.
       */
      basis: 'today' | 'at-proposal' | 'first-graded'
      /** With 'first-graded': when the original was taken (ISO). */
      frozenAt?: string | null
      /**
       * With 'first-graded': how the original was priced — at the time of the trade, or first-graded
       * where no market record covers the trade date (`gradeMoment`, 2026-10-03). Absent on older cards.
       */
      frozenBasis?: 'trade_date' | 'first_graded' | null
      pricedAsOf?: string | null
      tradeAt?: string | null
      /** League value `manager` sent and received — the totals the letter was taken on, when known. */
      valueGave?: number | null
      valueGot?: number | null
    }
  | { graded: false; reason: string }

const RANK: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 }

/**
 * `metadata.tradeCard.grade` as stored, narrowed — the renderer reads message metadata, which is data
 * from the database, not a typed object. Anything malformed is no grade; a letter outside A–F is no
 * grade (never shown as-is).
 */
export function readTradeCardGrade(raw: unknown): TradeCardGrade | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const g = raw as Record<string, unknown>
  if (g.graded === false) {
    return typeof g.reason === 'string' && g.reason.trim() ? { graded: false, reason: g.reason.trim() } : null
  }
  if (g.graded !== true) return null
  const letter = typeof g.letter === 'string' ? g.letter.trim().toUpperCase() : ''
  const partnerLetter = typeof g.partnerLetter === 'string' ? g.partnerLetter.trim().toUpperCase() : ''
  if (!(letter in RANK) || !(partnerLetter in RANK)) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const frozenAt = typeof g.frozenAt === 'string' && Number.isFinite(Date.parse(g.frozenAt)) ? g.frozenAt : null
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const frozenBasis = g.frozenBasis === 'trade_date' || g.frozenBasis === 'first_graded' ? g.frozenBasis : null
  return {
    graded: true,
    letter,
    partnerLetter,
    // 'first-graded' only with a readable moment: an original that cannot say when it was taken is not one.
    ...(g.basis === 'first-graded' && frozenAt
      ? { basis: 'first-graded' as const, frozenAt, frozenBasis, pricedAsOf: text(g.pricedAsOf), tradeAt: text(g.tradeAt) }
      : { basis: g.basis === 'at-proposal' ? ('at-proposal' as const) : ('today' as const) }),
    valueGave: num(g.valueGave),
    valueGot: num(g.valueGot),
  }
}

function rank(letter: string): number {
  return RANK[letter.trim().charAt(0).toUpperCase()] ?? 0
}

/** When the card's letters were taken, in the `gradeMoment` words every completed-trade surface uses. */
export function tradeCardGradeBasisLabel(
  grade: { basis: 'today' | 'at-proposal' | 'first-graded' } & GradeMomentInput,
): string {
  if (grade.basis === 'at-proposal') return 'graded when it was proposed'
  return `on this league's values ${gradeMoment(grade.basis === 'first-graded' ? grade : null)}`
}

/** "Casey D · Jordan B" — both letters, the card's first side first. */
export function tradeCardGradeLine(manager: string, partner: string | null | undefined, grade: TradeCardGrade): string {
  if (!grade.graded) return `Not graded: ${grade.reason}`
  return `${manager} ${grade.letter} · ${partner || 'their trade partner'} ${grade.partnerLetter}`
}

/**
 * The card's value fields. A GRADED card shows only the league values its letters were taken on — and
 * when those are missing (an older receipt), no numbers at all rather than market numbers that could
 * read against its letters. Otherwise, Chimmy's market take's numbers, as before.
 */
export function cardValues(
  grade: TradeCardGrade | null,
  take: { sides: readonly [{ sent: number; received: number }, unknown] } | null,
): { grade?: TradeCardGrade; valueGave: number | null; valueGot: number | null; valueBasis: 'league' | 'market' | null } {
  if (grade?.graded) {
    const known = typeof grade.valueGave === 'number' && typeof grade.valueGot === 'number'
    return {
      grade,
      valueGave: known ? grade.valueGave! : null,
      valueGot: known ? grade.valueGot! : null,
      valueBasis: known ? 'league' : null,
    }
  }
  return {
    ...(grade ? { grade } : {}),
    valueGave: take ? take.sides[0].sent : null,
    valueGot: take ? take.sides[0].received : null,
    valueBasis: take ? 'market' : null,
  }
}

/** Deterministic per trade, so a re-render or a retry says the same thing. */
function pick<T>(pool: readonly T[], seed: string): T {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return pool[h % pool.length]!
}

/**
 * Chimmy's message for a GRADED trade, worded from the letters and nothing else: who comes out ahead
 * is whoever holds the better letter, and an equal pair is even. Null for a withheld grade — the
 * caller keeps its plain summary, and the card says why there is no letter.
 */
export function gradedTradeTakeText(input: {
  manager: string
  partner: string | null | undefined
  grade: TradeCardGrade
  seed: string
}): string | null {
  const { grade } = input
  if (!grade.graded) return null
  const partner = input.partner || 'their trade partner'
  const letters = `${input.manager} ${grade.letter}, ${partner} ${grade.partnerLetter}`
  const basis = tradeCardGradeBasisLabel(grade)
  const a = rank(grade.letter)
  const b = rank(grade.partnerLetter)
  if (a === b) {
    const closer = pick(
      ['Fair deal. Now go win with it.', 'Nobody got fleeced. Rare, and respected.', 'Clean trade. Let the games settle it.'],
      `${input.seed}:even`,
    )
    return `League grade: ${letters} — even, ${basis}. ${closer}`
  }
  const [ahead, behind] = a > b ? [input.manager, partner] : [partner, input.manager]
  const closer = pick(
    [
      `${behind}, this one had better win you a week.`,
      `${behind} is betting on fit over the grade. We'll see.`,
      `${behind}, make it count.`,
    ],
    `${input.seed}:win`,
  )
  return `League grade: ${letters} — ${ahead} comes out ahead, ${basis}. ${closer}`
}
