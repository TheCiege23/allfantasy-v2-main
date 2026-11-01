/**
 * The Trade Center's server- and library-written text, as codes (2026-10-31): the commissioner review's
 * check explanations, its template note and act-on note, Find a Trade's match reasons, the redraft trade
 * routes' errors, the format models' reasons and labels, the reversal client's refusals, and the code-only
 * interest fallback.
 *
 * Three promises, each tested against the REAL producer and the REAL dictionaries:
 *   1. English is byte-identical: the English copy, filled with the codes' values, IS the old sentence.
 *   2. Spanish is Spanish: no raw key, no «waiver», no «traspaso», and it differs from the English.
 *   3. An unknown code falls back to the English sentence, never to a raw key.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { buildTradeReview, type ReviewCheck, type TradeReviewFacts } from '@/lib/decision-os/trade/tradeReview'
import { FLAG_WORDS } from '@/lib/decision-os/trade/templateVerdict'
import { findPartners, type DiscoveryRoster, type DiscoveryPlayer } from '@/lib/trade-discovery/redraftTradeDiscovery'
import { formatModelFor, formatModelForLeague } from '@/lib/trade-value/formats/registry'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import { previewGenericTradeReversal, requestGenericTradeReversal, requestNativeTradeReversal } from '@/lib/trade-reversal/client'
import {
  actOnNoteText,
  commissionerNoteText,
  formatLabelText,
  formatReasonText,
  localizeTradeReason,
  matchReasonsText,
  reversalMessageText,
  reviewCheckExplanation,
  reviewPartsText,
  serverErrorText,
} from '@/lib/i18n/trade-center-server-text'

const en = translations.en
const es = translations.es
const tEn = (k: string) => en[k] ?? k
const tEs = (k: string) => es[k] ?? k
// Source-shape checks should work with both Windows and Linux checkout line endings.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

/** Spanish that is really Spanish: no raw key, no «waiver», no «traspaso». */
function expectSpanish(text: string, english?: string) {
  expect(text, 'raw key').not.toMatch(/tradeCenter\.[a-zA-Z]/)
  expect(text.toLowerCase()).not.toContain('waiver')
  expect(text).not.toMatch(/traspaso/i)
  if (english != null) expect(text).not.toBe(english)
}

// ── 1. The commissioner review's checks ────────────────────────────────────────────────────────

const side = (over: Partial<NonNullable<NonNullable<Extract<TradeReviewFacts['lineup'], { ok: true }>['value'][0]>>> = {}) => ({
  startingBefore: 100,
  startingDelta: 2,
  receivedValue: 100,
  receivedBenchValue: 10,
  sentStarterNames: [] as string[],
  ...over,
})
const BASE: TradeReviewFacts = {
  sides: [{ name: 'Halcones' }, { name: 'Tigres' }],
  gapPct: { ok: true, value: 48 },
  lineup: { ok: true, value: [side(), side()] },
  history: { ok: true, value: [48] },
  inactiveDays: { ok: true, value: [3, 4] },
  playoffPct: { ok: true, value: [60, 40] },
  deadlineAt: { ok: true, value: null },
  now: '2026-10-01T00:00:00.000Z',
  managerDivisions: { ok: true, value: [3, 3] },
}
const no = (reason: string) => ({ ok: false as const, reason })
const IN_WINDOW = { ok: true as const, value: '2026-10-02T12:00:00.000Z' }
const TANK = side({ startingDelta: -20, receivedValue: 100, receivedBenchValue: 80 })

/** Facts that between them reach every branch of every check. */
const VARIANTS: TradeReviewFacts[] = [
  BASE,
  { ...BASE, gapPct: { ok: true, value: 5 }, history: { ok: true, value: [20, 30] }, inactiveDays: { ok: true, value: [20, 3] } },
  { ...BASE, gapPct: no('One side of this trade has no assets recorded.'), deadlineAt: IN_WINDOW, managerDivisions: { ok: true, value: [5, 2] } },
  { ...BASE, lineup: { ok: true, value: [TANK, TANK] }, history: { ok: true, value: [20, null, 20] }, inactiveDays: { ok: true, value: [20, 30] } },
  {
    ...BASE,
    leagueType: { type: 'dynasty', label: 'Dynasty' },
    lineup: { ok: true, value: [TANK, side()] },
    history: { ok: true, value: [20, 20, 20] },
    inactiveDays: { ok: true, value: [3, null] },
    deadlineAt: IN_WINDOW,
    managerDivisions: { ok: true, value: [5, 2] },
  },
  {
    ...BASE,
    gapPct: { ok: true, value: -48 },
    lineup: { ok: true, value: [null, side()] },
    history: { ok: true, value: [20, -20, 20] },
    playoffPct: { ok: true, value: [0.5, 60] },
    deadlineAt: { ok: true, value: '2026-12-01T00:00:00.000Z' },
    managerDivisions: { ok: true, value: [5, 2] },
  },
  {
    ...BASE,
    lineup: { ok: true, value: [side({ sentStarterNames: ['Juan Pérez', 'Luis García'] }), side()] },
    playoffPct: { ok: true, value: [0.5, 60] },
    deadlineAt: IN_WINDOW,
    gapPct: { ok: true, value: 12 },
    managerDivisions: { ok: true, value: [null, 3] },
  },
  {
    ...BASE,
    lineup: no('Lineup effect is only measured while a trade is still pending.'),
    history: no('Trade history could not be read.'),
    inactiveDays: no('Manager activity could not be read.'),
    playoffPct: no('No season forecast has been run for this league.'),
    deadlineAt: no('The schedule for week 13 (the trade deadline) is not loaded, so the deadline has no time.'),
    managerDivisions: no('Manager Classes could not be read.'),
  },
  {
    ...BASE,
    managerDivisions: undefined,
    playoffPct: no('x'),
    standing: { ok: true, value: [{ eliminated: true, holdsPlayoffSpot: false }, { eliminated: false, holdsPlayoffSpot: true }] },
    lineup: { ok: true, value: [side({ sentStarterNames: ['Raúl Díaz'] }), side()] },
  },
  {
    ...BASE,
    playoffPct: no('x'),
    standing: { ok: true, value: [{ eliminated: true, holdsPlayoffSpot: false }, { eliminated: false, holdsPlayoffSpot: true }] },
    lineup: { ok: true, value: [null, side()] },
  },
  {
    ...BASE,
    playoffPct: no('x'),
    standing: { ok: true, value: [{ eliminated: false, holdsPlayoffSpot: true }, { eliminated: false, holdsPlayoffSpot: false }] },
  },
]
const CHECKS: ReviewCheck[] = VARIANTS.flatMap((f) => buildTradeReview(f).checks)

const REVIEW_TEXT_CODES = Object.keys(en)
  .filter((k) => k.startsWith('tradeCenter.reviewText.') && !/\.(note|flag)\./.test(k))
  .map((k) => k.slice('tradeCenter.reviewText.'.length))

describe('review check explanations', () => {
  it('every check carries parts, and the variants reach every code the dictionary has (a battery that misses one proves nothing about it)', () => {
    expect(CHECKS.length).toBe(VARIANTS.length * 7)
    expect(CHECKS.filter((c) => !c.explanationParts?.length)).toEqual([])
    const seen = new Set(CHECKS.flatMap((c) => c.explanationParts!.map((p) => p.code)))
    expect(REVIEW_TEXT_CODES.length).toBeGreaterThanOrEqual(30)
    expect(REVIEW_TEXT_CODES.filter((c) => !seen.has(c))).toEqual([])
    expect([...seen].filter((c) => c !== 'reason' && !REVIEW_TEXT_CODES.includes(c))).toEqual([])
  })

  it('every code tradeReview.ts emits has copy (read off the source, so a new code without copy fails here)', () => {
    const src = read('lib/decision-os/trade/tradeReview.ts')
    const emitted = [...new Set([...src.matchAll(/part\('([a-zA-Z.]+)'/g)].map((m) => m[1]!))]
    expect(emitted.length).toBeGreaterThanOrEqual(30)
    // `reason` is the pass-through part (a sentence the facts carried), localized by the trade catalog instead.
    expect(emitted.filter((c) => c !== 'reason' && !REVIEW_TEXT_CODES.includes(c))).toEqual([])
  })

  it('ENGLISH IS BYTE-IDENTICAL: the English copy filled with the parts is the explanation, for every check', () => {
    for (const c of CHECKS) expect(reviewPartsText(c.explanationParts!, tEn, 'en'), `${c.code} ${c.status}`).toBe(c.explanation)
    // And the English screen never goes through the copy at all.
    for (const c of CHECKS) expect(reviewCheckExplanation(c, tEs, 'en')).toBe(c.explanation)
  })

  it('Spanish: every coded explanation is Spanish', () => {
    for (const c of CHECKS) {
      const text = reviewCheckExplanation(c, tEs, 'es')
      const reasonOnly = c.explanationParts!.every((p) => p.code === 'reason')
      expectSpanish(text, reasonOnly ? undefined : c.explanation)
    }
    const lopsided = CHECKS.find((c) => c.code === 'heavily_lopsided' && c.status === 'raised')!
    expect(reviewCheckExplanation(lopsided, tEs, 'es')).toBe(
      'Halcones recibe un 48% más de valor de liga: supera la línea del 40% de un intercambio muy desequilibrado.',
    )
    const rebuild = CHECKS.find((c) => c.code === 'rebuild_signal' && c.status === 'raised')!
    expect(reviewCheckExplanation(rebuild, tEs, 'es')).toMatch(/^En una liga dynasty esto se interpreta como una reconstrucción/)
  })

  it('a reason the facts carried is translated through the trade catalog, inside a sentence and on its own', () => {
    const notGraded = CHECKS.find((c) => c.code === 'heavily_lopsided' && c.status === 'not_computed')!
    expect(reviewCheckExplanation(notGraded, tEs, 'es')).toBe('El intercambio no está calificado: Un lado del intercambio no tiene activos registrados.')
    const forecast = CHECKS.find((c) => c.explanation === 'No season forecast has been run for this league.')!
    expect(reviewCheckExplanation(forecast, tEs, 'es')).toBe('Todavía no se ha hecho un pronóstico de temporada para esta liga.')
    const schedule = CHECKS.find((c) => c.code === 'deadline_rush' && c.status === 'not_computed' && c.explanationParts![0]!.code === 'reason')!
    expect(reviewCheckExplanation(schedule, tEs, 'es')).toBe(
      'El calendario de la semana 13 (la de la fecha límite de intercambios) no está cargado, así que la fecha límite no tiene hora.',
    )
    // A reason the catalog does not know stays as written: English, never a key.
    expect(localizeTradeReason('Something brand new.', 'es')).toBe('Something brand new.')
    expect(localizeTradeReason('Trade history could not be read.', 'en')).toBe('Trade history could not be read.')
  })

  it('an unknown code, a missing param or no parts at all falls back to the English explanation', () => {
    const c = { explanation: 'The English sentence.' }
    expect(reviewCheckExplanation({ ...c, explanationParts: [{ code: 'not_a_code' }] }, tEs, 'es')).toBe('The English sentence.')
    expect(reviewCheckExplanation({ ...c, explanationParts: [{ code: 'reason' }] }, tEs, 'es')).toBe('The English sentence.')
    expect(reviewCheckExplanation({ ...c, explanationParts: [] }, tEs, 'es')).toBe('The English sentence.')
    expect(reviewCheckExplanation(c, tEs, 'es')).toBe('The English sentence.')
  })
})

// ── The note to the league and the act-on note ──────────────────────────────────────────────────

describe('the commissioner note and the act-on note', () => {
  const codes = Object.keys(FLAG_WORDS)

  it('the flag words keep the template’s English word for word, and the template still writes the shape the rebuild expects', () => {
    expect(codes.length).toBeGreaterThanOrEqual(8)
    for (const code of codes) expect(en[`tradeCenter.reviewText.flag.${code}`], code).toBe(FLAG_WORDS[code])
    const src = read('lib/decision-os/trade/templateVerdict.ts')
    expect(src).toContain(`'${en['tradeCenter.reviewText.note.none']}'`)
    expect(src).toContain('`Flagged for the commissioner: ${noted.join(\'; \')}.`')
    expect(src).toContain(`' ${en['tradeCenter.reviewText.note.gaps']}'`)
    expect(en['tradeCenter.reviewText.note.flagged']).toBe('Flagged for the commissioner: {{flags}}.')
  })

  it('a template note is rebuilt in Spanish: flags, no flags, and the not-run sentence; English rebuilt the same way is the template', () => {
    const raised = buildTradeReview(VARIANTS[3]!)
    const flagged = `Flagged for the commissioner: ${raised.flags.map((f) => FLAG_WORDS[f.code]).join('; ')}. Some checks could not be run and are listed in the review.`
    const args = { note: flagged, source: 'template' as const, review: raised }
    // Rebuilt with the English copy, it is the template's own sentence — byte-identical.
    expect(commissionerNoteText(args, tEn, 'es')).toBe(flagged)
    const spanish = commissionerNoteText(args, tEs, 'es')!
    expectSpanish(spanish, flagged)
    expect(spanish).toMatch(/^Señalado para el comisionado: una diferencia de valor muy desequilibrada; /)
    expect(spanish).toMatch(/ Algunas comprobaciones no se pudieron hacer y aparecen en la revisión\.$/)

    const clean = { ...buildTradeReview({ ...BASE, gapPct: { ok: true, value: 5 } }) }
    const none = 'No review flags were raised for this trade.'
    expect(clean.flags).toEqual([])
    expect(commissionerNoteText({ note: none, source: 'template', review: clean }, tEn, 'es')).toBe(none)
    expect(commissionerNoteText({ note: none, source: 'template', review: clean }, tEs, 'es')).toBe('No se levantó ninguna alerta de revisión en este intercambio.')
  })

  it('an AI note, English, a note of another shape and an unknown flag all stay as written', () => {
    const r = buildTradeReview(VARIANTS[3]!)
    const ai = 'A model wrote this.'
    expect(commissionerNoteText({ note: ai, source: 'ai', review: r }, tEs, 'es')).toBe(ai)
    expect(commissionerNoteText({ note: 'Flagged for the commissioner: x.', source: 'template', review: r }, tEs, 'en')).toBe('Flagged for the commissioner: x.')
    expect(commissionerNoteText({ note: 'Something else.', source: 'template', review: r }, tEs, 'es')).toBe('Something else.')
    const odd = { ...r, flags: [{ code: 'brand_new' as never, severity: 'low' as const, explanation: '' }] }
    expect(commissionerNoteText({ note: 'Flagged for the commissioner: brand_new.', source: 'template', review: odd }, tEs, 'es')).toBe(
      'Flagged for the commissioner: brand_new.',
    )
  })

  it('the act-on note: the route’s English unchanged, Spanish from the code', () => {
    const route = read('app/api/leagues/[leagueId]/trades/[tradeId]/review/route.ts')
    expect(route).toContain('note: `Approve or veto this trade on ${result.trade.origin.platform}.`')
    const actOn = { platform: 'Sleeper', note: 'Approve or veto this trade on Sleeper.' }
    expect(en['tradeCenter.review.actOnNote']!.replace('{{platform}}', 'Sleeper')).toBe(actOn.note)
    expect(actOnNoteText(actOn, tEs, 'en')).toBe(actOn.note)
    expect(actOnNoteText(actOn, tEs, 'es')).toBe('Aprueba o veta este intercambio en Sleeper.')
  })
})

// ── 2. Find a Trade's match reasons ─────────────────────────────────────────────────────────────

const dp = (playerId: string, position: string, value: number | null): DiscoveryPlayer => ({ playerId, playerName: `${position} ${playerId}`, position, value, isLocked: false })
const ME: DiscoveryRoster = {
  rosterId: 'me', teamName: 'Mine', stance: 'contender', weakPositions: ['WR'], strongPositions: ['RB'], faabBalance: 50, recentTradeCount: 1,
  players: [dp('r1', 'RB', 4000), dp('r2', 'RB', 3500), dp('r3', 'RB', 3000), dp('q1', 'QB', 4500), dp('t1', 'TE', 2500)],
}
const THEM: DiscoveryRoster = {
  rosterId: 'p1', teamName: 'Theirs', stance: 'rebuilder', weakPositions: ['RB'], strongPositions: ['WR'], faabBalance: 30, recentTradeCount: 2,
  players: [dp('w1', 'WR', 3800), dp('w2', 'WR', 3400), dp('w3', 'WR', 3000), dp('q2', 'QB', 4000), dp('t2', 'TE', 2400)],
}
const QUIET: DiscoveryRoster = { ...THEM, rosterId: 'p2', stance: 'middle', strongPositions: [], recentTradeCount: 0, players: [dp('k1', 'QB', 1), dp('k2', 'TE', 1)] }

describe('match reasons', () => {
  const matches = [
    ...findPartners({ myRoster: ME, otherRosters: [{ ...THEM, blockPlayerIds: ['w1'] }], sport: 'NFL', hasNativeBlock: true, myInterest: { playerIds: ['w2'], positions: [] } }),
    ...findPartners({ myRoster: { ...ME, stance: 'middle', players: [dp('a', 'QB', 1)] }, otherRosters: [QUIET], sport: 'NFL' }),
  ]
  const MATCH_CODES = Object.keys(en).filter((k) => k.startsWith('tradeCenter.discovery.reason.')).map((k) => k.split('.').pop()!)

  it('the codes line up with the reasons, and the fixtures reach every code', () => {
    for (const m of matches) expect(m.matchReasonCodes.length).toBe(m.matchReasons.length)
    const seen = new Set(matches.flatMap((m) => m.matchReasonCodes.map((c) => c.code)))
    expect(MATCH_CODES.length).toBe(7)
    expect(MATCH_CODES.filter((c) => !seen.has(c as never))).toEqual([])
    const union = read('lib/trade-discovery/redraftTradeDiscovery.ts').match(/export type MatchReasonCode =([^]*?)\n\n/)![1]!
    expect([...union.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]).sort()).toEqual([...MATCH_CODES].sort())
  })

  it('ENGLISH IS BYTE-IDENTICAL, and Spanish is Spanish', () => {
    for (const m of matches) {
      expect(m.matchReasonCodes.map((c) => tEn(`tradeCenter.discovery.reason.${c.code}`).replace('{{positions}}', c.params?.positions ?? ''))).toEqual(m.matchReasons)
      expect(matchReasonsText(m, tEs, 'en')).toEqual(m.matchReasons)
      const spanish = matchReasonsText(m, tEs, 'es')
      spanish.forEach((s, i) => expectSpanish(s, m.matchReasons[i]))
    }
    expect(matchReasonsText(matches[0]!, tEs, 'es')[0]).toBe('Te sobra RB y ellos lo necesitan')
  })

  it('an older server (no codes), a length mismatch or an unknown code keeps the English list', () => {
    const m = { matchReasons: ['A reason'] }
    expect(matchReasonsText(m, tEs, 'es')).toEqual(['A reason'])
    expect(matchReasonsText({ ...m, matchReasonCodes: [] }, tEs, 'es')).toEqual(['A reason'])
    expect(matchReasonsText({ ...m, matchReasonCodes: [{ code: 'nope' }] }, tEs, 'es')).toEqual(['A reason'])
  })
})

// ── 3. The redraft trade routes' errors ─────────────────────────────────────────────────────────

const ROUTES = [
  'app/api/redraft/trades/discovery/route.ts',
  'app/api/redraft/trades/package-finder/route.ts',
  'app/api/redraft/trades/trade-block/route.ts',
  'app/api/redraft/trades/trade-block/[itemId]/route.ts',
  'app/api/redraft/trades/interests/route.ts',
  'app/api/redraft/trades/interests/[interestId]/route.ts',
]

describe('route error codes', () => {
  const pairs = ROUTES.flatMap((f) => [...read(f).matchAll(/\{ error: '([^']+)', code: '([a-z_]+)' \}/g)].map((m) => ({ f, english: m[1]!, code: m[2]! })))
  const service = read('lib/trade-block/redraftTradeBlockService.ts')
  const thrown = [...service.matchAll(/new TradeBlockValidationError\('([^']+)', '([a-z_]+)'\)/g)].map((m) => ({ english: m[1]!, code: m[2]! }))

  it('every English error a manager can meet carries a code, and every code has copy', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(30)
    // Left bare on purpose: a request missing its own parameters ("leagueId required") is the client's bug, not a manager's message.
    for (const f of ROUTES) {
      const bare = [...read(f).matchAll(/\{ error: '([^']+)' \}/g)].map((m) => m[1]!)
      expect(bare.filter((e) => !/ required$/.test(e)), f).toEqual([])
    }
    expect(thrown.length).toBe(5)
    for (const { code } of [...pairs, ...thrown]) {
      expect(en[`tradeCenter.serverError.${code}`], code).toBeTruthy()
      expect(es[`tradeCenter.serverError.${code}`], code).toBeTruthy()
    }
  })

  it('a code’s English copy is the route’s own English where one code means one sentence', () => {
    const byCode = new Map<string, Set<string>>()
    for (const { code, english } of [...pairs, ...thrown]) byCode.set(code, (byCode.get(code) ?? new Set()).add(english))
    for (const [code, englishes] of byCode) {
      if (englishes.size === 1) expect(en[`tradeCenter.serverError.${code}`], code).toBe([...englishes][0])
    }
    // The one code that covers two sentences: discovery's and the package finder's own-team refusal.
    expect([...byCode.get('own_team_only')!].sort()).toEqual(['You can only build packages from your own team', 'You can only discover trades for your own team'])
  })

  it('English keeps the server’s message; Spanish says the code; an unknown code or none keeps the English', () => {
    const err = Object.assign(new Error('You do not have a roster in this league'), { code: 'no_roster', status: 403 })
    expect(serverErrorText(err, 'x', tEs, 'en')).toBe('You do not have a roster in this league')
    expect(serverErrorText(err, 'x', tEs, 'es')).toBe('No tienes una plantilla en esta liga.')
    expect(serverErrorText({ message: 'Odd new thing', code: 'brand_new' }, 'x', tEs, 'es')).toBe('Odd new thing')
    expect(serverErrorText({ message: 'Odd new thing' }, 'x', tEs, 'es')).toBe('Odd new thing')
    expect(serverErrorText({ message: 'Request failed (502)', code: null }, 'x', tEs, 'es')).toBe('La solicitud falló (502).')
    expect(serverErrorText({ message: 'Request failed (502)', code: null }, 'x', tEs, 'en')).toBe('Request failed (502)')
    expect(serverErrorText({ message: 'Too many reviews at once. Try again shortly.', code: 'rate_limited' }, 'x', tEs, 'es', 'review')).toBe(
      'Demasiadas revisiones a la vez. Vuelve a intentarlo en un momento.',
    )
  })

  it('the review route’s own codes have copy, and the refusal codes it passes through do too', () => {
    const route = read('app/api/leagues/[leagueId]/trades/[tradeId]/review/route.ts')
    const own = [...route.matchAll(/\{ error: '([^']+)', code: '([a-z_]+)' \}/g)]
    expect(own.length).toBe(3)
    for (const m of own) expect(en[`tradeCenter.review.error.${m[2]}`], m[2]).toBe(m[1])
    const refusals = read('lib/decision-os/trade/tradeRecord.ts').match(/export type TradeRefusalCode =([^]*?)\n\n/)![1]!
    const codes = [...refusals.matchAll(/\| '([a-z_]+)'/g)].map((m) => m[1]!)
    expect(codes.length).toBeGreaterThanOrEqual(8)
    for (const c of codes) expect(es[`tradeCenter.review.error.${c}`], c).toBeTruthy()
  })

  it('the client attaches the route’s code and status to the error it throws', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'You do not have a roster in this league', code: 'no_roster' }) })) as never
    try {
      const { fetchMyInterests } = await import('@/lib/redraft/client')
      const e = (await fetchMyInterests('L').catch((x) => x)) as Error & { code: string; status: number }
      expect(e).toBeInstanceOf(Error)
      expect(e.message).toBe('You do not have a roster in this league')
      expect(e.code).toBe('no_roster')
      expect(e.status).toBe(403)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

// ── 4. Format labels and reasons ────────────────────────────────────────────────────────────────

const shape = buildLeagueShape({ teams: 12, starterSlots: ['QB', 'RB', 'WR', 'FLEX'], rosterSize: 16, deadlineWeek: 12, irSlots: 10, taxiSlots: 10 })!
const at = (over: Record<string, unknown> = {}) => ({ base: 5000, position: 'WR', shape, ...over }) as never

describe('format reasons and labels', () => {
  const koth = formatModelForLeague({ leagueType: 'redraft', aliasTags: ['king_of_the_hill'] })!
  const pirate = formatModelForLeague({ leagueType: 'dynasty', aliasTags: ['pirate_vampire'] })!
  const survivor = formatModelFor('survivor')!
  const guilly = formatModelFor('guillotine')!
  const four = formatModelFor('four_horsemen')!
  const tournament = formatModelFor('tournament')!
  const cap = formatModelFor('salary_cap')!
  const results = [
    koth.adjust(at({ teamState: { viewerIsKing: false } })),
    koth.adjust(at({ teamState: { viewerIsKing: true, weeklyLossProbability: 0.4 }, assetState: { topThreeScorerProbability: 0.5 } })),
    koth.canTrade!(at({ teamState: { playoffStartWeek: 14 }, currentWeek: 14 })),
    koth.canTrade!(at({ currentWeek: 13 })),
    pirate.canTrade!(at({ teamState: { inLockWindow: true } })),
    survivor.adjust(at({ acquiringTeamState: { survivalProbabilityBefore: 0.4, survivalProbabilityAfter: 0.5 } })),
    survivor.canTrade!(at({ teamState: { eliminated: true } })),
    survivor.canTrade!(at({ teamState: { exiled: true } })),
    guilly.canTrade!(at({ teamState: { teamsRemaining: 8, startingTeams: 12, eliminated: true } })),
    guilly.canTrade!(at({ teamState: { teamsRemaining: 8, startingTeams: 12 }, currentWeek: 13 })),
    four.adjust(at({ teamState: { eliminatorEliminated: true } })),
    four.adjust(at({ teamState: { eliminatorStrikes: 3 } })),
    four.adjust(at({ teamState: { eliminatorStrikes: 1 } })),
    four.adjust(at({ teamState: { eliminatorStrikes: 2 } })),
    four.adjust(at({ experience: 1 })),
    four.canTrade!(at({ currentWeek: 13 })),
    tournament.adjust(at({ teamState: { roundsRemaining: 4, startingRounds: 4 } })),
    tournament.adjust(at({ teamState: { roundsRemaining: 2, startingRounds: 4 } })),
    cap.canTrade!(at({})),
  ]
  const CODES = Object.keys(en).filter((k) => k.startsWith('tradeCenter.value.formatReason.')).map((k) => k.slice('tradeCenter.value.formatReason.'.length))

  it('each case produced a coded reason, and between them every coded reason the models write (salaryCap.unverified aside)', () => {
    for (const [i, r] of results.entries()) {
      expect(r, String(i)).toBeTruthy()
      expect((r as { reasonCode?: string }).reasonCode, String(i)).toBeTruthy()
    }
    const seen = new Set(results.map((r) => (r as { reasonCode: string }).reasonCode))
    expect(CODES.filter((c) => !seen.has(c))).toEqual(['salaryCap.unverified'])
    const written = new Set(
      fs.readdirSync('lib/trade-value/formats').flatMap((f) => [...read(`lib/trade-value/formats/${f}`).matchAll(/reasonCode: (?:[^'\n]*\? )?'([a-zA-Z.]+)'(?: : '([a-zA-Z.]+)')?/g)].flatMap((m) => [m[1], m[2]].filter(Boolean) as string[])),
    )
    expect([...written].sort()).toEqual([...CODES].sort())
  })

  it('ENGLISH IS BYTE-IDENTICAL, and Spanish is Spanish without «waiver»', () => {
    for (const r of results as Array<{ reason: string; reasonCode: string; reasonParams?: Record<string, string | number> }>) {
      let english = en[`tradeCenter.value.formatReason.${r.reasonCode}`]!
      for (const [k, v] of Object.entries(r.reasonParams ?? {})) english = english.split(`{{${k}}}`).join(String(v))
      expect(english, r.reasonCode).toBe(r.reason)
      expect(formatReasonText(r, tEs, 'en')).toBe(r.reason)
      expectSpanish(formatReasonText(r, tEs, 'es')!, r.reason)
    }
  })

  it('labels: Spanish where the format has a Spanish name, the brand name where it does not, English unchanged', () => {
    expect(formatLabelText('king_of_the_hill', 'King of the Hill', tEs, 'es')).toBe('Rey de la Colina')
    expect(formatLabelText('king_of_the_hill', 'King of the Hill', tEs, 'en')).toBe('King of the Hill')
    expect(formatLabelText('guillotine', 'Guilly', tEs, 'es')).toBe('Guilly')
    expect(formatLabelText(null, 'Superflex', tEs, 'es')).toBe('Superflex')
    expect(formatLabelText('x', null, tEs, 'es')).toBeNull()
    for (const k of Object.keys(en).filter((x) => x.startsWith('tradeCenter.value.formatLabel.'))) {
      expect(formatModelFor(k.split('.').pop()!)?.label, k).toBe(en[k])
    }
  })

  it('a reason with no code or an unknown code stays as written', () => {
    expect(formatReasonText({ reason: 'Prose from another module.' }, tEs, 'es')).toBe('Prose from another module.')
    expect(formatReasonText({ reason: 'Prose.', reasonCode: 'nope' }, tEs, 'es')).toBe('Prose.')
    expect(formatReasonText({ reason: undefined }, tEs, 'es')).toBeNull()
  })
})

// ── 5. Reverse trade ────────────────────────────────────────────────────────────────────────────

describe('reversal refusals', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })
  const respond = (status: number, body: unknown) => {
    globalThis.fetch = (status === 0 ? vi.fn(async () => Promise.reject(new Error('offline'))) : vi.fn(async () => ({ status, json: async () => body }))) as never
  }

  it.each([
    [0, null, 'preflight', 'Could not reach AllFantasy to check this trade. Try again.', 'No se pudo conectar con AllFantasy para comprobar este intercambio. Inténtalo de nuevo.'],
    [403, { error: 'Commissioner access required' }, 'preflight', 'Only a commissioner can reverse a trade.', 'Solo un comisionado puede revertir un intercambio.'],
    [500, null, 'preflight', 'Could not check whether this trade can be reversed.', 'No se pudo comprobar si este intercambio se puede revertir.'],
    [404, { error: 'Proposal not found' }, 'preflight', 'Proposal not found', 'No se encontró este intercambio.'],
    [0, null, 'outcome', 'The connection dropped before AllFantasy confirmed the result. Refresh to see whether the trade was reversed.', 'La conexión se cortó antes de que AllFantasy confirmara el resultado. Actualiza la página para ver si el intercambio se revirtió.'],
    [403, null, 'outcome', 'Only a commissioner can reverse a trade. Nothing was changed.', 'Solo un comisionado puede revertir un intercambio. No se cambió nada.'],
    [500, null, 'outcome', 'The trade could not be reversed. Nothing was changed.', 'No se pudo revertir el intercambio. No se cambió nada.'],
    [500, { error: 'Trade reversal failed', code: 'REVERSAL_FAILED' }, 'outcome', 'Trade reversal failed Nothing was changed.', 'No se pudo revertir el intercambio. No se cambió nada.'],
    [409, { error: 'Trade cannot be reversed', code: 'REVERSAL_BLOCKED', readiness: { ok: false, blockers: ['ALREADY_REVERSED'] } }, 'outcome', 'Trade cannot be reversed Nothing was changed.', 'Este intercambio no se puede revertir. No se cambió nada.'],
  ])('status %s (%s)', async (status, body, phase, english, spanish) => {
    respond(status as number, body)
    const r = phase === 'preflight' ? await previewGenericTradeReversal('l', 't') : await requestNativeTradeReversal('p', 'why')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toBe(english)
    expect(reversalMessageText(r, phase as 'preflight', tEs, 'en')).toBe(english)
    expect(reversalMessageText(r, phase as 'preflight', tEs, 'es')).toBe(spanish)
    expectSpanish(spanish)
  })

  it('a server error with no code we know keeps its English, and still says «nothing was changed» in Spanish', async () => {
    respond(400, { error: 'Something only the server knows.' })
    const r = await requestGenericTradeReversal('l', 't', 'why')
    if (r.ok) throw new Error('expected a refusal')
    expect(r.message).toBe('Something only the server knows. Nothing was changed.')
    expect(reversalMessageText(r, 'outcome', tEs, 'es')).toBe('Something only the server knows. No se cambió nada.')
    // A refusal from an older client (no code) is shown as written.
    expect(reversalMessageText({ message: 'Old message.' }, 'outcome', tEs, 'es')).toBe('Old message.')
  })

  it('every message code the client writes has copy in both phases where it can occur', () => {
    const src = read('lib/trade-reversal/client.ts')
    const used = [...new Set([...src.matchAll(/messageCode: '([a-z_]+)'/g), ...src.matchAll(/serverRefusal\(r, '([a-z_]+)'\)/g)].map((m) => m[1]!))]
    // `server` carries the server's own error, said through `tradeCenter.reverseDialog.server.<CODE>` (tested above).
    expect(used.sort()).toEqual(['check_failed', 'connection_dropped', 'not_commissioner', 'reverse_failed', 'server', 'unreachable'])
    used.splice(used.indexOf('server'), 1)
    const keys = Object.keys(en).filter((k) => k.startsWith('tradeCenter.reverseDialog.message.'))
    for (const c of used) expect(keys.some((k) => k.endsWith(`.${c}`)), c).toBe(true)
  })
})

// ── 6. Interests, TradesTab, and the dictionary itself ──────────────────────────────────────────

const NEW_PREFIXES = [
  'tradeCenter.reviewText.',
  'tradeCenter.review.actOnNote',
  'tradeCenter.review.error.',
  'tradeCenter.serverError.',
  'tradeCenter.discovery.reason.',
  'tradeCenter.block.interestType.',
  'tradeCenter.value.formatLabel.',
  'tradeCenter.value.formatReason.',
  'tradeCenter.reverseDialog.message.',
  'tradeCenter.reverseDialog.server.',
  'tradeCenter.reverseDialog.team',
]
const NEW_KEYS = Object.keys(en).filter((k) => NEW_PREFIXES.some((p) => k.startsWith(p)))

describe('the new keys', () => {
  it('exist in both languages, the Spanish differs from the English, and it never says «waiver» or «traspaso»', () => {
    expect(NEW_KEYS.length).toBeGreaterThanOrEqual(120)
    expect(NEW_KEYS.filter((k) => !(k in es))).toEqual([])
    expect(NEW_KEYS.filter((k) => es[k] === en[k])).toEqual([])
    expect(NEW_KEYS.filter((k) => /waiver|traspaso/i.test(es[k]!))).toEqual([])
    for (const k of NEW_KEYS) if (en[k]!.includes('FAAB')) expect(es[k], k).toContain('FAAB')
  })

  it('placeholders match between English and Spanish', () => {
    const vars = (s: string) => [...s.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]).sort()
    for (const k of NEW_KEYS) expect(vars(es[k]!), k).toEqual(vars(en[k]!))
  })

  it('the interest types: English is the raw code (unchanged), Spanish is words, for every type the service accepts', async () => {
    const { INTEREST_TYPES } = await import('@/lib/trade-block/redraftTradeBlockService')
    for (const type of INTEREST_TYPES) {
      expect(en[`tradeCenter.block.interestType.${type}`]).toBe(type)
      expectSpanish(es[`tradeCenter.block.interestType.${type}`]!, type)
    }
  })

  it('TradesTab names the dialog’s fallback teams through the dictionary, and the English is the old literal', () => {
    const src = read('app/league/[leagueId]/tabs/TradesTab.tsx')
    const dialog = src.slice(src.indexOf('<ReverseTradeDialog'), src.indexOf('/>', src.indexOf('<ReverseTradeDialog')))
    expect(dialog).not.toContain("'Team A'")
    expect(dialog).not.toContain("'Team B'")
    expect(src).toContain("tLang('tradeCenter.reverseDialog.teamA')")
    expect(src).toContain("tLang('tradeCenter.reverseDialog.teamB')")
    expect([en['tradeCenter.reverseDialog.teamA'], en['tradeCenter.reverseDialog.teamB']]).toEqual(['Team A', 'Team B'])
    expect([es['tradeCenter.reverseDialog.teamA'], es['tradeCenter.reverseDialog.teamB']]).toEqual(['Equipo A', 'Equipo B'])
  })
})
