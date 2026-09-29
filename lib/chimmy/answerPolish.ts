/**
 * "Answer polish" for Chimmy's chat answers — the wire shapes and client-side readers. Client-safe:
 * no imports at all, so the drawer can use it without pulling anything server-side into its bundle.
 *
 * Three things ride on an answer's `meta`, all built on the server from ENGINE data, never from the
 * model's prose (see `answerPolishBuild.ts`):
 *
 *   - `verdict` — a small pill at the top of the answer: HOLD / BID / START / YES / NO / COUNTER.
 *   - `faabPlan` — the structured `get_faab_bid_plan` result as a compact card.
 *   - `answerKeys` — which whole-league deterministic tools ran, for which league, so an earlier
 *     answer can be marked "Newer answer below" when a later one re-ran the same tool.
 *
 * 🛑 NO VERDICT IS EVER READ OUT OF TEXT. A model that wrote "hold" in a sentence does not get a
 * HOLD chip; only an engine outcome does, and an answer with no engine outcome gets no chip. That is
 * the whole value of the chip: it is the one part of the answer the model cannot have made up.
 */

/** The verdicts a chip can show. The label is fixed per key — the wire never carries display text. */
export type ChimmyVerdictKey = 'yes' | 'no' | 'hold' | 'counter' | 'counter_hold' | 'start' | 'start_both' | 'sit_both' | 'bid'

/** go = act, stop = do not, wait = hold off / renegotiate. Colour AND text carry it. */
export type ChimmyVerdictTone = 'go' | 'stop' | 'wait'

/** Which engine decided — shown as the chip's title so "who says so" is one hover away. */
export type ChimmyVerdictSource = 'trade_engine' | 'lineup_engine' | 'faab_plan'

export type ChimmyVerdict = {
  key: ChimmyVerdictKey
  source: ChimmyVerdictSource
  /** A player name, e.g. START "Kyren Williams". Null when the verdict needs no object. */
  detail: string | null
}

export const VERDICT_LABEL: Record<ChimmyVerdictKey, { label: string; tone: ChimmyVerdictTone }> = {
  yes: { label: 'YES', tone: 'go' },
  no: { label: 'NO', tone: 'stop' },
  hold: { label: 'HOLD', tone: 'wait' },
  counter: { label: 'COUNTER', tone: 'wait' },
  counter_hold: { label: 'COUNTER / HOLD', tone: 'wait' },
  start: { label: 'START', tone: 'go' },
  start_both: { label: 'START BOTH', tone: 'go' },
  sit_both: { label: 'SIT BOTH', tone: 'stop' },
  bid: { label: 'BID', tone: 'go' },
}

export const VERDICT_SOURCE_LABEL: Record<ChimmyVerdictSource, string> = {
  trade_engine: 'Decided by the AllFantasy trade engine',
  lineup_engine: "Decided by this week's lineup projection under your league's scoring",
  faab_plan: 'Decided by the FAAB bid plan',
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const shortText = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A `meta.verdict` (or `meta.decision.verdict`) the drawer may render, or null. */
export function readChimmyVerdict(value: unknown): ChimmyVerdict | null {
  if (!isRecord(value)) return null
  const key = value.key
  const source = value.source
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(VERDICT_LABEL, key)) return null
  if (typeof source !== 'string' || !Object.prototype.hasOwnProperty.call(VERDICT_SOURCE_LABEL, source)) return null
  return { key: key as ChimmyVerdictKey, source: source as ChimmyVerdictSource, detail: shortText(value.detail, 80) }
}

/* ── The FAAB bid card ──────────────────────────────────────────────────────────────────────── */

/** How many bids the card lists — the same cap as the model's text (`FAAB_TEXT_MAX_BIDS`). */
export const FAAB_CARD_MAX_BIDS = 8

export type ChimmyFaabCardBid = {
  name: string
  position: string | null
  /** Dollars to bid up to; null outside an elimination league or with no remaining FAAB on file. */
  ceiling: number | null
  /** His share of this week's upgrade value, whole percent. */
  sharePct: number
  /** Who leaves the lineup for him; null when he fills an empty seat or the slots were assumed. */
  displacedName: string | null
}

export type ChimmyFaabCard = {
  version: 1
  leagueName: string
  /** save = nobody improves the lineup; bid = dollars or shares (elimination); rank = ranked, no dollars. */
  outcome: 'save' | 'bid' | 'rank'
  elimination: boolean
  remaining: number | null
  seasonBudget: number | null
  /** The league's slots were not on file, so a standard lineup was assumed. The card says so. */
  lineupAssumed: boolean
  valuesAsOf: string
  bids: ChimmyFaabCardBid[]
  /** Upgrades beyond the listed ones. */
  moreCount: number
  /** Valued unrostered players who would not improve the lineup. */
  nonUpgrades: number
  pricedCount: number
  /** The platform's VERIFIED waiver screen for this league, or null — never a homepage. */
  waiverLink: { href: string; label: string } | null
}

function readBid(v: unknown): ChimmyFaabCardBid | null {
  if (!isRecord(v)) return null
  const name = shortText(v.name, 80)
  const sharePct = finite(v.sharePct)
  if (!name || sharePct == null) return null
  const ceiling = finite(v.ceiling)
  return {
    name,
    position: shortText(v.position, 12),
    ceiling: ceiling == null ? null : Math.max(0, Math.round(ceiling)),
    sharePct: Math.max(0, Math.min(100, Math.round(sharePct))),
    displacedName: shortText(v.displacedName, 80),
  }
}

/** A `meta.faabPlan` the drawer may render, or null. A half-shaped card is dropped, never guessed at. */
export function readChimmyFaabCard(value: unknown): ChimmyFaabCard | null {
  if (!isRecord(value) || value.version !== 1) return null
  const outcome = value.outcome
  if (outcome !== 'save' && outcome !== 'bid' && outcome !== 'rank') return null
  if (!Array.isArray(value.bids)) return null
  const bids = value.bids.map(readBid)
  if (bids.some((b) => b == null)) return null
  if (outcome !== 'save' && bids.length === 0) return null
  const link = isRecord(value.waiverLink) ? value.waiverLink : null
  const href = link && typeof link.href === 'string' && /^https:\/\//.test(link.href) ? link.href : null
  const label = link ? shortText(link.label, 60) : null
  return {
    version: 1,
    leagueName: shortText(value.leagueName, 120) ?? 'your league',
    outcome,
    elimination: value.elimination === true,
    remaining: finite(value.remaining),
    seasonBudget: finite(value.seasonBudget),
    lineupAssumed: value.lineupAssumed === true,
    valuesAsOf: shortText(value.valuesAsOf, 20) ?? '',
    bids: (bids as ChimmyFaabCardBid[]).slice(0, FAAB_CARD_MAX_BIDS),
    moreCount: Math.max(0, Math.round(finite(value.moreCount) ?? 0)),
    nonUpgrades: Math.max(0, Math.round(finite(value.nonUpgrades) ?? 0)),
    pricedCount: Math.max(0, Math.round(finite(value.pricedCount) ?? 0)),
    waiverLink: href && label ? { href, label } : null,
  }
}

/**
 * Everything the polish reads off one answer's `meta`. A tool-loop answer carries these at the top
 * level; a decision-engine answer carries them inside `meta.decision` (`decisionAnswerMeta`), which
 * is also what a private @chimmy reply stores on its message — so one reader serves every surface.
 */
export function readAnswerPolish(meta: unknown): { verdict: ChimmyVerdict | null; faabPlan: ChimmyFaabCard | null; answerKeys: string[] } {
  if (!isRecord(meta)) return { verdict: null, faabPlan: null, answerKeys: [] }
  const decision = isRecord(meta.decision) ? meta.decision : null
  const verdict = readChimmyVerdict(meta.verdict) ?? (decision && decision.status === 'ready' ? readChimmyVerdict(decision.verdict) : null)
  const keys = [...readAnswerKeys(meta.answerKeys), ...(decision && decision.status === 'ready' ? readAnswerKeys(decision.answerKeys) : [])]
  return { verdict, faabPlan: readChimmyFaabCard(meta.faabPlan), answerKeys: readAnswerKeys(keys) }
}

/* ── "Newer answer below" ───────────────────────────────────────────────────────────────────── */

/**
 * Tools whose result is ONE current state of a league, so a later run for the same league makes an
 * earlier answer's result out of date: the bid plan, the best lineup, the playoff outlook. Every one
 * takes no arguments. A tool that answers a question about a NAMED player or trade is deliberately
 * absent — "should I start X or Y" does not supersede "should I start A or B".
 */
export const SUPERSEDING_TOOLS = ['get_faab_bid_plan', 'optimize_my_lineup', 'get_playoff_outlook'] as const

/** `<tool>:<leagueId>` — the identity two answers must share for the later one to supersede. */
export function answerKey(tool: string, leagueId: string): string {
  return `${tool}:${leagueId}`
}

/** The `meta.answerKeys` of an answer, or an empty list. Anything that is not a known key shape is dropped. */
export function readAnswerKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tools = new Set<string>(SUPERSEDING_TOOLS)
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || v.length > 200) continue
    const at = v.indexOf(':')
    if (at <= 0 || !tools.has(v.slice(0, at)) || at === v.length - 1) continue
    if (!out.includes(v)) out.push(v)
  }
  return out.slice(0, 8)
}

/**
 * For each Chimmy answer that a LATER answer in the same thread re-ran a superseding tool for the
 * same league, the id of the nearest such later answer. Deterministic from the stored keys only.
 */
export function newerAnswers(turns: ReadonlyArray<{ id: string; role: string; answerKeys?: string[] | null }>): Map<string, string> {
  const out = new Map<string, string>()
  /* The nearest later answer carrying each key, filled walking backwards. */
  const latest = new Map<string, { id: string; index: number }>()
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i]!
    if (t.role !== 'chimmy' || !Array.isArray(t.answerKeys) || t.answerKeys.length === 0) continue
    let nearest: { id: string; index: number } | null = null
    for (const key of t.answerKeys) {
      const later = latest.get(key)
      if (later && (!nearest || later.index < nearest.index)) nearest = later
    }
    if (nearest) out.set(t.id, nearest.id)
    for (const key of t.answerKeys) latest.set(key, { id: t.id, index: i })
  }
  return out
}
