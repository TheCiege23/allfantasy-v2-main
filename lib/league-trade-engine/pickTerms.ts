/**
 * CONDITIONAL AND PROTECTED PICKS — terms a native future pick carries when it is traded, settled
 * when its rookie draft is created.
 *
 * Two kinds, one per pick:
 *
 *   protected    "Top-3 protected": if the original team's pick lands in picks 1–3 of its round,
 *                it stays with the original team. Either nothing conveys (`stays`), or the original
 *                team's pick in the same round of the NEXT draft conveys instead, unprotected
 *                (`rolls_over`)
 *   conditional  "becomes a 1st if Bravo misses the playoffs": when a named team makes or misses
 *                the playoffs in the season before the draft, the pick becomes the original team's
 *                pick in another round, or does not convey at all
 *
 * The slot is the draft's final order (the saved rookie order, a lottery result or last season's
 * standings — whatever `createNextLeagueDraft` seats), so a term is judged exactly once, on the
 * order the draft actually uses. A swap needs the original team to still hold the pick being
 * swapped in; when it does not, the base pick conveys and the record says why.
 *
 * Terms travel with the pick: a later trade moves the pick and its terms to the new holder, and a
 * pick that already carries terms cannot be given new ones until they are settled.
 *
 * AF Commissioner: the commissioner switches them on (`League.settings.pick_terms_rule`), and they
 * can be added to an offer only while the league owner holds the plan. Terms already agreed are
 * always settled, because both teams traded on them.
 *
 * Pure.
 */

export const PICK_TERMS_RULE_KEY = 'pick_terms_rule'
/** League.settings: pick id → its settled terms and, once its draft exists, the outcome. */
export const PICK_TERMS_KEY = 'pick_terms'

export type PickProtection = { kind: 'protected'; top: number; ifProtected: 'stays' | 'rolls_over' }
export type PickCondition = {
  kind: 'conditional'
  /** Roster.id of the team whose season decides it. */
  teamRosterId: string
  event: 'makes_playoffs' | 'misses_playoffs'
  effect: 'becomes_round' | 'does_not_convey'
  /** The round it becomes, for `becomes_round`. */
  round?: number
}
export type PickTerms = PickProtection | PickCondition

export type PickTermsOutcome =
  | 'conveyed'
  | 'protected'
  | 'protected_rolled_over'
  | 'became_round'
  | 'did_not_convey'
  | 'condition_not_met'
  /** The term could not be judged (no slot, no playoff field, or the swap pick was gone): the base pick conveyed. */
  | 'conveyed_unjudged'
  /** The pick was back with its original team when its draft was created. */
  | 'returned'

export type PickTermsRecord = {
  terms: PickTerms
  tradeId: string | null
  setAt: string
  result?: { outcome: PickTermsOutcome; at: string; note?: string | null; round?: number | null } | null
}

/**
 * `fdp:<season>:<round>:<originalRosterId>` → its parts. The same rule as nativeFuturePicks'
 * `parseInventoryPickId`, kept here so a client component can read an offer's pick without importing
 * a server module.
 */
export function parseFuturePickRef(ref: string): { season: number; round: number; originalRosterId: string } | null {
  const m = /^fdp:(\d{4}):(\d{1,2}):(.+)$/.exec(ref)
  if (!m || !(Number(m[2]) > 0)) return null
  return { season: Number(m[1]), round: Number(m[2]), originalRosterId: m[3]! }
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

export function readPickTermsEnabled(settings: unknown): boolean {
  return asObject(asObject(settings)?.[PICK_TERMS_RULE_KEY])?.enabled === true
}

export function parsePickTermsRule(raw: unknown): { ok: true; value: { enabled: boolean } } | { ok: false; error: string } {
  const o = asObject(raw)
  if (!o || typeof o.enabled !== 'boolean') return { ok: false, error: 'Send { enabled: true } or { enabled: false }.' }
  return { ok: true, value: { enabled: o.enabled } }
}

/** Every settled record, keyed by pick id, in a shape the reader knows. */
export function readPickTermsRecords(settings: unknown): Record<string, PickTermsRecord> {
  const raw = asObject(asObject(settings)?.[PICK_TERMS_KEY])
  if (!raw) return {}
  const out: Record<string, PickTermsRecord> = {}
  for (const [id, rec] of Object.entries(raw)) {
    const o = asObject(rec)
    const terms = o && validShape(o.terms)
    if (terms) out[id] = { terms, tradeId: typeof o!.tradeId === 'string' ? o!.tradeId : null, setAt: String(o!.setAt ?? ''), result: (asObject(o!.result) as PickTermsRecord['result']) ?? null }
  }
  return out
}

function validShape(raw: unknown): PickTerms | null {
  const o = asObject(raw)
  if (!o) return null
  if (o.kind === 'protected' && Number.isInteger(o.top) && (o.ifProtected === 'stays' || o.ifProtected === 'rolls_over')) {
    return { kind: 'protected', top: o.top as number, ifProtected: o.ifProtected }
  }
  if (
    o.kind === 'conditional' &&
    typeof o.teamRosterId === 'string' &&
    (o.event === 'makes_playoffs' || o.event === 'misses_playoffs') &&
    (o.effect === 'does_not_convey' || (o.effect === 'becomes_round' && Number.isInteger(o.round)))
  ) {
    return { kind: 'conditional', teamRosterId: o.teamRosterId, event: o.event, effect: o.effect, ...(o.effect === 'becomes_round' ? { round: o.round as number } : {}) }
  }
  return null
}

/** Terms as an offer sends them, checked against the league. */
export function parsePickTerms(
  raw: unknown,
  ctx: { teamCount: number; rounds: number; rosterIds: ReadonlySet<string>; pickRound: number },
): { ok: true; value: PickTerms } | { ok: false; error: string } {
  const terms = validShape(raw)
  if (!terms) return { ok: false, error: 'Those pick terms are not ones this league can settle.' }
  if (terms.kind === 'protected') {
    if (terms.top < 1 || terms.top >= ctx.teamCount) return { ok: false, error: `Protection is top 1 to top ${Math.max(1, ctx.teamCount - 1)}.` }
    return { ok: true, value: terms }
  }
  if (!ctx.rosterIds.has(terms.teamRosterId)) return { ok: false, error: 'The condition names a team that is not in this league.' }
  if (terms.effect === 'becomes_round' && (terms.round! < 1 || terms.round! > ctx.rounds || terms.round === ctx.pickRound)) {
    return { ok: false, error: `The pick can become another round from 1 to ${ctx.rounds}.` }
  }
  return { ok: true, value: terms }
}

export type PickTermsResolution =
  | { outcome: 'conveyed' }
  | { outcome: 'protected'; rollsOver: boolean }
  | { outcome: 'became_round'; round: number }
  | { outcome: 'did_not_convey' }
  | { outcome: 'condition_not_met' }
  | { outcome: 'conveyed_unjudged'; note: string }

/**
 * How a pick's terms settle. `slot` is where the original team's pick sits in its round (1 = first),
 * null when the team is not seated; `playoffTeams` is the season-before's playoff field, null when it
 * is not on file.
 */
export function resolvePickTerms(input: { terms: PickTerms; slot: number | null; playoffTeams: ReadonlySet<string> | null }): PickTermsResolution {
  const t = input.terms
  if (t.kind === 'protected') {
    if (input.slot == null) return { outcome: 'conveyed_unjudged', note: 'The original team has no seat in this draft.' }
    return input.slot <= t.top ? { outcome: 'protected', rollsOver: t.ifProtected === 'rolls_over' } : { outcome: 'conveyed' }
  }
  if (!input.playoffTeams) return { outcome: 'conveyed_unjudged', note: 'Last season’s playoff field is not on file.' }
  const made = input.playoffTeams.has(t.teamRosterId)
  const met = t.event === 'makes_playoffs' ? made : !made
  if (!met) return { outcome: 'condition_not_met' }
  return t.effect === 'does_not_convey' ? { outcome: 'did_not_convey' } : { outcome: 'became_round', round: t.round! }
}

const ORD_EN = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`

/** One short line for a pick's terms, in either language. */
export function describePickTerms(terms: PickTerms, nameOf: (rosterId: string) => string, lang: 'en' | 'es', originalTeam: string): string {
  const es = lang === 'es'
  if (terms.kind === 'protected') {
    const base = es ? `protegida top ${terms.top}` : `top-${terms.top} protected`
    if (terms.ifProtected === 'stays') return es ? `${base} (si cae en 1–${terms.top}, se queda con ${originalTeam})` : `${base} (if it lands 1–${terms.top}, it stays with ${originalTeam})`
    return es
      ? `${base} (si cae en 1–${terms.top}, pasa la selección de ${originalTeam} de la misma ronda del año siguiente)`
      : `${base} (if it lands 1–${terms.top}, ${originalTeam}'s same-round pick the next year conveys instead)`
  }
  const team = nameOf(terms.teamRosterId)
  const when = es ? (terms.event === 'makes_playoffs' ? `si ${team} llega a playoffs` : `si ${team} no llega a playoffs`) : terms.event === 'makes_playoffs' ? `if ${team} makes the playoffs` : `if ${team} misses the playoffs`
  if (terms.effect === 'does_not_convey') return es ? `no se entrega ${when}` : `does not convey ${when}`
  return es ? `pasa a ser de ronda ${terms.round} ${when}` : `becomes a ${ORD_EN(terms.round!)} ${when}`
}

/** What happened, for the record shown on the Trades page and to Chimmy. */
export function describeOutcome(rec: PickTermsRecord, lang: 'en' | 'es'): string | null {
  const r = rec.result
  if (!r) return null
  const es = lang === 'es'
  const text: Record<PickTermsOutcome, [string, string]> = {
    conveyed: ['conveyed', 'se entregó'],
    protected: ['protected: stayed with the original team', 'protegida: se quedó con el equipo original'],
    protected_rolled_over: ['protected: next year’s pick conveys instead', 'protegida: se entrega la del año siguiente'],
    became_round: [`became the round ${r.round ?? '?'} pick`, `pasó a ser la de ronda ${r.round ?? '?'}`],
    did_not_convey: ['did not convey', 'no se entregó'],
    condition_not_met: ['condition not met: conveyed as is', 'condición no cumplida: se entregó tal cual'],
    conveyed_unjudged: ['could not be judged: conveyed as is', 'no se pudo evaluar: se entregó tal cual'],
    returned: ['back with the original team', 'volvió al equipo original'],
  }
  return text[r.outcome][es ? 1 : 0]
}
