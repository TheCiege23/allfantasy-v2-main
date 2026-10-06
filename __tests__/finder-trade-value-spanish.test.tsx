/**
 * Player Finder's trade-and-value cards in Spanish (2026-10-05): the trade visual, the trade windows
 * (one league and every league), the market-value trend, "Your shares" with its team split, and the
 * league-in-context card. Group T of the three subcomponent PRs.
 *
 * Every value is REAL formatter output where one exists: the grade's label and recommendation from
 * `tradeGradeLabel` / `tradeGradeRecommendation`, a withheld grade from `gradeTrade`, the scoring note
 * from `describeScoringFit`, the no-trade note from `tradeBanReason`, the unreadable-league reason from
 * `coverageReason`, the readiness chip from `readiness`, the trend from `changeOver` / `nudgeFor`, the
 * value book from `describeValueBook`, the team split from `buildTeamSplit`, the actions from
 * `leagueViewActions` (inside the card), the window line and the pitch from `pitchLine` / `pitchText`.
 * The loader reasons that are DB-bound are held to their loader's source file verbatim instead, so a
 * reworded reason fails here rather than silently going English.
 *
 * The scan reads visible text plus every title, aria-label and placeholder, with every "?" tip open.
 * The AF Pro lock (CoreDepthLock) is shared, and reads Spanish too since 2026-10-06; nothing is cut.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { TradeVisual } from '@/components/core-app/player-finder/TradeVisual'
import { TradeWindow } from '@/components/core-app/player-finder/TradeWindow'
import { TradeWindows } from '@/components/core-app/player-finder/TradeWindows'
import { ValueTrend } from '@/components/core-app/player-finder/ValueTrend'
import { PlayerSharesBoard } from '@/components/core-app/player-finder/PlayerSharesBoard'
import { LeagueOwnershipCard } from '@/components/core-app/player-finder/LeagueOwnershipCard'
import type { PlayerBidInstead, PlayerTradeVisual, TradeVisualGrade, TradeVisualPackage } from '@/lib/core-app/playerTradeVisual'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { ManagerPresence, PresenceManager } from '@/lib/core-app/managerPresence'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import type { PlayerShares } from '@/lib/core-app/playerShares'
import type { LeagueShareView } from '@/lib/core-app/playerSharesLeague'
import { gradeTrade, tradeGradeLabel, tradeGradeRecommendation } from '@/lib/decision-os/trade/tradeGrade'
import type { GradeLetter } from '@/lib/decision-os/trade/tradeGrade'
import { describeScoringFit } from '@/lib/trade-value/scoringFit'
import { tradeBanReason } from '@/lib/league-rules/tradeLegality'
import { coverageReason } from '@/lib/core-app/rosterIdCoverage'
import { readiness } from '@/lib/core-app/playerMoves'
import { changeOver, nudgeFor, type BookTrend, type TrendPoint } from '@/lib/core-app/valueTrend'
import { describeValueBook } from '@/lib/core-app/valueBook'
import { buildTeamSplit } from '@/lib/core-app/teamSplit'
import { pitchLine, pitchText } from '@/lib/core-app/tradePitch'
import { TRADE_VALUE_REASON_KEYS } from '@/lib/core-app/finderTradeValueCopy'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
/**
 * The six cards' own English, word by word. Names in the fixtures avoid every one. Kept in Spanish on
 * purpose and so not here: PPR, superflex, 1QB, redraft, IR, taxi, FAAB, AF Pro, pts, the platforms.
 */
const OWN_EN =
  /\b(Trade|trades?|bid|bidding|upgrade|improve|lineup|Up to|budget|Open|league|leagues|allow|format|takes|balanced|package|packages|buying|selling|needs|deep|give|get|Nothing|market|value|Values|Grade|Other|finder|Send|never|window|windows|when|move|moves|moved|reachable|usually|ingested|start|bench|pitch|Pitch|Ask|Last|claim|Copy|Copied|owners?|soonest|could not|Market|days|since|month|history|Sell-high|Buy-low|Big drop|week|bigger|hold|isn|captured|shares|players|rosters?|platform|starting|You|Another|Free agent|readable|games?|stats|scoring|Ranked|starters|slots?|clubs?|bye|None|Bye|roster|commissioner|THEY|THEIR|Unrostered|proj|Read-only|show you|Claim|Even|Slightly|favors|Major|win|Favors|overpay|Thin|Set|Deep|dynasty|evenings|mornings|middays|afternoons|nights|(?:min|mo|[smhdwy]) ago|just now|sign in|not found|claimed|matched|already|did not|graded|Adjusted|reception|Tournament|waivers|chopped|share|Yours)\b/

const SCAN_ATTRS = ['title', 'aria-label', 'placeholder']

/** Visible text plus every title, aria-label and placeholder. */
function ownText(container: HTMLElement): string {
  const root = container.cloneNode(true) as HTMLElement
  const attrs = [...root.querySelectorAll(SCAN_ATTRS.map((a) => `[${a}]`).join(','))].flatMap((n) => SCAN_ATTRS.map((a) => n.getAttribute(a) ?? ''))
  return [root.textContent ?? '', ...attrs].join(' | ')
}

function expectSpanish(container: HTMLElement, label: string) {
  container.querySelectorAll('.af-pf-help-dot').forEach((b) => fireEvent.click(b))
  const out = ownText(container)
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  const hit = out.match(OWN_EN)
  expect(hit?.[0] ?? null, `${label}: …${hit ? out.slice(Math.max(0, hit.index! - 70), hit.index! + 70) : ''}…`).toBeNull()
  return out
}

const writeText = vi.fn()
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  lang.language = 'en'
})

/* ── The trade visual ──────────────────────────────────────────────────────────────────────────── */

const KINCAID = { kind: 'player' as const, playerId: '10236', name: 'Dalton Kincaid', position: 'TE', value: 3010 }
const POLLARD = { kind: 'player' as const, playerId: 'rb3', name: 'Tony Pollard', position: 'RB', value: 3140 }
const STEVENSON = { kind: 'player' as const, playerId: 'rb4', name: 'Rhamondre Stevenson', position: 'RB', value: 2610 }

/** THE grade, as the grader writes it for these totals. */
function grade(letter: GradeLetter, giveValue: number, getValue: number, pct: number): SectionState<TradeVisualGrade> {
  return {
    available: true,
    data: {
      letter,
      partnerLetter: letter,
      label: tradeGradeLabel(pct).label,
      recommendation: tradeGradeRecommendation({ letter, giveValue, getValue }),
      giveValue,
      getValue,
      basis: 'Keeper · 1QB · 12 teams · Half PPR',
    },
  }
}
const G_D = grade('D', 3140, 2610, -17)
const G_B = grade('B', 2610, 3010, 13)

const P1: TradeVisualPackage = {
  id: 'p1', give: [POLLARD], receive: [KINCAID], giveTotal: 3140, receiveTotal: 3010, delta: -1130, fairness: 'balanced', confidence: 85,
  reasons: ['Target player is on the trade block', 'Fills one of your roster needs'], warnings: [], grade: G_D,
}
const P2: TradeVisualPackage = { ...P1, id: 'p2', give: [STEVENSON], giveTotal: 2610, delta: 400, fairness: 'slight edge you', reasons: [], grade: G_B }

const SCORING_NOTE = describeScoringFit({ rec: 1, bonus_rec_te: 0.5 } as never, 1)!
const VISUAL: PlayerTradeVisual = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'sleeper', platformLeagueId: '123456', season: 2026,
  target: { sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', value: 3010 },
  you: { teamName: 'Cafe Con Chimmy', ownerName: 'guap', externalId: '2', stance: 'contender', stanceSettled: true, needs: ['TE'], surpluses: ['RB'] },
  partner: { teamName: 'Titanes', ownerName: 'tashaR', externalId: '1', stance: 'rebuilder', stanceSettled: true, needs: ['RB', 'WR'], surpluses: ['TE'] },
  values: { mode: 'dynasty', source: 'fantasycalc', fetchedAt: '2026-09-02T12:00:00Z', ppr: 1, numQbs: 2, scoringAdjustment: SCORING_NOTE },
  bidInstead: null,
  packages: [P1, P2],
  recommended: P1,
  grade: G_D,
}

/** A bid as `bidFor` writes it — its English sentence and the parts it was built from. */
function bid(over: Partial<PlayerBidInstead> & { parts: NonNullable<PlayerBidInstead['parts']> }): PlayerBidInstead {
  return { concept: 'guillotine', budgetTotal: 1000, marginalValue: 2100, shareOfSupply: 0.2283, ceilingAtRemaining: 91, budgetRemaining: 400, reason: 'English as bidFor wrote it', ...over }
}

describe('the trade visual, in Spanish', () => {
  it('the full card: heading, partner line, both sides, the grade, the reasons, the others, the hand-off and the foot', () => {
    lang.language = 'es'
    const { container } = render(<TradeVisual state={{ available: true, data: VISUAL }} playerName="Dalton Kincaid" />)
    const out = expectSpanish(container, 'full card')
    expect(out).toContain('Intercambiar por Kincaid')
    expect(out).toContain('Qué hace falta para conseguir a Kincaid de Titanes')
    expect(out).toContain('Titanes · @tashaR · en reconstrucción · necesita RB, WR · le sobra en TE')
    expect(out).toContain('Envías')
    expect(out).toContain('Recibes')
    // The grade label is the Trade Center's own Spanish, and the counter figure is the grader's.
    expect(container.querySelector('.af-pf-tv-verdict .af-pf-tv-grade')?.textContent).toBe('D · Favorece ligeramente al rival')
    expect(out).toContain('Favorece al otro lado según el valor de liga. Una contraoferta necesita recibir unos 530 más para quedar equilibrada.')
    expect(out).toContain('-1,130 de valor de mercado para ti')
    expect(out).toContain('El jugador buscado está en el mercado de intercambios')
    expect(out).toContain('Rhamondre Stevenson por Dalton Kincaid')
    expect(out).toContain('B · Te favorece ligeramente')
    expect(out).toContain('Envíalo en Sleeper')
    expect(out).toContain('Abrir Centro de intercambios')
    expect(out).toContain('Los valores son valores de mercado de AllFantasy (dinastía, 1 PPR, superflex).')
    expect(out).toMatch(/Ajustado a las reglas de recepción propias de esta liga, que la tabla de 1 PPR no puede expresar: TE \+[\d.]+%\./)
    expect(out).toContain('AllFantasy nunca envía un intercambio: lo envías tú en Sleeper.')
    expect(container.querySelector('.af-pf-tv-asset-value')?.getAttribute('title')).toBe('Valor de mercado de AllFantasy')
  })

  it('every recommendation the grader writes, letter by letter', () => {
    lang.language = 'es'
    const cases: Array<[GradeLetter, number, number, number]> = [['A', 2000, 3000, 33], ['B', 2610, 3010, 13], ['C', 3000, 3050, 2], ['D', 3140, 2610, -17], ['F', 3000, 2000, -33]]
    for (const [letter, give, get, pct] of cases) {
      const g = grade(letter, give, get, pct)
      const { container, unmount } = render(<TradeVisual state={{ available: true, data: { ...VISUAL, recommended: { ...P1, grade: g }, packages: [P1] } }} playerName="Dalton Kincaid" />)
      expectSpanish(container, `letter ${letter}`)
      unmount()
    }
  })

  it('a grade that could not be taken says why — the loader’s own reasons and the grader’s withheld one', () => {
    lang.language = 'es'
    const withheld = gradeTrade({
      giveValue: 3140, getValue: 3010, giveMarket: 3140, getMarket: 3010, unpriced: 1, giveCount: 1, getCount: 1,
      basis: 'x', scoringApplied: false, needApplied: false, needGap: null, lines: [], moves: [],
    })
    if (withheld.graded) throw new Error('expected a withheld grade')
    const reasons = ['the trade grade did not answer in time', 'this package could not be graded just now', withheld.reason.replace(/\.$/, '')]
    for (const reason of reasons) {
      const { container, unmount } = render(
        <TradeVisual state={{ available: true, data: { ...VISUAL, packages: [P1], recommended: { ...P1, grade: { available: false, reason } } } }} playerName="Dalton Kincaid" />,
      )
      const out = expectSpanish(container, reason)
      expect(out).toContain('Calificación: ')
      unmount()
    }
  })

  it('no balanced package, and every reason the loader gives for no card at all', () => {
    lang.language = 'es'
    const { container, unmount } = render(<TradeVisual state={{ available: true, data: { ...VISUAL, packages: [], recommended: null } }} playerName="Dalton Kincaid" />)
    expect(expectSpanish(container, 'no package')).toContain('Ahora mismo no hay un paquete equilibrado por Kincaid con Titanes')
    unmount()
    const src = readFileSync(join(process.cwd(), 'lib/core-app/playerTradeVisual.ts'), 'utf8')
    const cardReasons = [
      'sign in to build a trade for him', 'league not found', 'you need a claimed team in this league to build a trade',
      "this league's player ids can't be matched to ours yet, so we can't tell who holds him",
      'he is not on any roster we can read here — claim him instead of trading for him', 'he is already on your roster in this league',
      'no market values are loaded for this league’s format yet, so a package cannot be priced',
    ]
    for (const reason of cardReasons) {
      if (!reason.includes("can't be matched")) expect(src, reason).toContain(`'${reason}'`)
      const r = render(<TradeVisual state={{ available: false, reason }} playerName="Dalton Kincaid" />)
      expectSpanish(r.container, reason)
      r.unmount()
    }
  })

  it('a no-trade league: the catalog’s note, and the fallback', () => {
    lang.language = 'es'
    const ban = tradeBanReason({ leagueType: 'tournament', isDynasty: false, settings: {} })!
    expect(ban).toBeTruthy()
    for (const tradeBan of [ban, undefined]) {
      const { container, unmount } = render(
        <TradeVisual state={{ available: true, data: { ...VISUAL, packages: [], recommended: null, tradesAllowed: false, ...(tradeBan ? { tradeBan } : {}) } }} playerName="Dalton Kincaid" />,
      )
      expect(expectSpanish(container, `ban ${tradeBan}`)).toContain('Esta liga no permite intercambios')
      unmount()
    }
  })

  it('the bid card, rebuilt from its parts: paced, unpaced with FAAB unknown, and no upgrade', () => {
    lang.language = 'es'
    const bids = [
      bid({ ceilingAtRemaining: 23, parts: { bid: 'upgrade', sharePct: 23, weekBudget: 100, paced: true, budgetRemaining: 400, weeksAssumed: 4, faabKnown: true } }),
      bid({ ceilingAtRemaining: null, budgetRemaining: null, parts: { bid: 'upgrade', sharePct: 23, weekBudget: 0, paced: false, budgetRemaining: 0, weeksAssumed: 1, faabKnown: false } }),
      bid({ marginalValue: -300, ceilingAtRemaining: 0, shareOfSupply: 0, parts: { bid: 'no-upgrade', sharePct: 0, weekBudget: 400, paced: false, budgetRemaining: 400, weeksAssumed: 1, faabKnown: true } }),
      bid({ marginalValue: 0, ceilingAtRemaining: 0, shareOfSupply: 0, parts: { bid: 'unpriced', sharePct: 0, weekBudget: 400, paced: false, budgetRemaining: 400, weeksAssumed: 1, faabKnown: true } }),
    ]
    const outs = bids.map((b) => {
      const { container, unmount } = render(<TradeVisual state={{ available: true, data: { ...VISUAL, packages: [], recommended: null, tradesAllowed: false, bidInstead: b } }} playerName="Dalton Kincaid" />)
      const out = expectSpanish(container, `bid ${b.parts!.bid}`)
      unmount()
      return out
    })
    expect(outs[0]).toContain('Hasta $23: el 23% del valor de mejora de su plantilla.')
    expect(outs[0]).toContain('tus $400 repartidos en unas 4.0 semanas más.')
    expect(outs[1]).toContain('El 23% de tu presupuesto')
    expect(outs[1]).toContain('No tenemos tu FAAB restante en esta liga')
    expect(outs[2]).toContain('Kincaid no mejoraría tu alineación')
  })
})

/* ── Trade windows ─────────────────────────────────────────────────────────────────────────────── */

const NOW = '2026-10-25T14:30:00.000Z' // Sun 10:30a ET
const PKG = { give: ['Tony Pollard'], fairness: 'balanced' }

function mgr(over: Partial<PresenceManager>): PresenceManager {
  return {
    role: 'owner', teamName: 'Titanes', ownerName: 'tashaR', avatarUrl: null, externalId: '1', record: '4-2', rank: 3,
    need: null, startsHim: true, window: null, lastMove: null, moves: 0, ...over,
  }
}
const SUN_MORNING = { weekday: 0, startHour: 10, endHour: 12, daypart: 'morning' as const, precision: 'window' as const, share: 0.8, sample: 12, zone: 'ET' }
const TUE_EVENINGS = { weekday: 2, startHour: 17, endHour: 22, daypart: 'evening' as const, precision: 'daypart' as const, share: 0.5, sample: 9, zone: 'ET' }
const THU_LATE = { weekday: 4, startHour: 22, endHour: 24, daypart: 'late' as const, precision: 'daypart' as const, share: 0.4, sample: 8, zone: 'ET' }

const OWNED: ManagerPresence = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'sleeper', platformLeagueId: '123456', season: 2026,
  timeZone: 'America/New_York', zone: 'ET', player: { sleeperId: '10236', position: 'TE' }, holder: 'other',
  managers: [mgr({ window: SUN_MORNING, lastMove: { at: '2026-10-25T13:00:00.000Z', kind: 'waiver' }, moves: 13 })],
  activityIngested: true, newestMove: '2026-10-25T13:00:00.000Z', unattributed: 0,
}
const BUYERS: ManagerPresence = {
  ...OWNED,
  holder: 'yours',
  unattributed: 3,
  managers: [
    mgr({ role: 'buyer', ownerName: 'riv', externalId: '3', window: TUE_EVENINGS, need: { position: 'TE', held: 1, starters: 1, level: 'thin' }, moves: 9 }),
    mgr({ role: 'buyer', ownerName: 'lou', externalId: '4', window: THU_LATE, need: { position: 'TE', held: 2, starters: 1, level: 'set' }, rank: null, moves: 8 }),
    mgr({ role: 'buyer', ownerName: 'kim', externalId: '5', record: null, rank: null, need: { position: 'TE', held: 4, starters: 2, level: 'deep' }, moves: 5, lastMove: { at: '2026-10-22T13:00:00.000Z', kind: 'trade' } }),
    mgr({ role: 'buyer', ownerName: 'zed', externalId: '6', need: null, moves: 0 }),
  ],
}

describe('the trade windows, in Spanish', () => {
  it('one league, the owner in their window: the line, the tip, the pitch on the clipboard', async () => {
    lang.language = 'es'
    const { container, getByRole } = render(
      <TradeWindow state={{ available: true, data: OWNED }} playerName="Dalton Kincaid" pkg={PKG} gradeHref="#af-pf-tv" tradeCenterHref="/core/trades" nowIso={NOW} />,
    )
    const out = expectSpanish(container, 'window owner')
    expect(out).toContain('@tashaR suele moverse los dom 10a–12p ET')
    expect(out).toContain('Alinea a Kincaid de titular en Gridiron Gang. Ofrece Tony Pollard por Kincaid: los valores están equilibrados. Proponlo ahora: es su ventana.')
    fireEvent.click(getByRole('button', { name: 'Copiar la propuesta' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const pitch = writeText.mock.calls[0]![0] as string
    expect(pitch).toBe('Hola tashaR, ¿cambiarías a Dalton Kincaid por Tony Pollard? En AllFantasy los valores están equilibrados. Si hay alguna versión de eso que harías, te escucho.')
    expect(pitch).not.toMatch(OWN_EN)
    await waitFor(() => expect(container.textContent).toContain('Copiado'))
  })

  it('one league, he is yours: every buyer line — a later window, a daypart, no set time, no move yet — and the notes', async () => {
    lang.language = 'es'
    const { container, getByRole } = render(
      <TradeWindow state={{ available: true, data: BUYERS }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/core/trades" nowIso={NOW} />,
    )
    const out = expectSpanish(container, 'window buyers')
    expect(out).toContain('Escaso en TE (1 para 1 puesto), 4-2, #3: ofrécele a Kincaid ahí. Proponlo los mar por la noche, no ahora.')
    expect(out).toContain('@lou suele moverse los jue de madrugada ET')
    expect(out).toContain('@kim se mueve sin horario fijo')
    expect(out).toContain('Último intercambio: hace 3 d.')
    expect(out).toContain('@zed no ha hecho ningún movimiento aquí')
    expect(out).toContain('3 movimientos de esta liga no se pudieron atribuir a nadie.')
    fireEvent.click(getByRole('button', { name: 'Copiar la propuesta' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0]![0]).toBe('Hola riv, se te ve escaso en TE: ¿te interesa Dalton Kincaid? Dime a quién moverías y lo paso por AllFantasy.')
  })

  it('one league: nothing ingested, nobody to pitch, and every reason the loader gives', () => {
    lang.language = 'es'
    const cold = { ...OWNED, activityIngested: false, managers: [mgr({ moves: 0 })] }
    let r = render(<TradeWindow state={{ available: true, data: cold }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/x" nowIso={NOW} />)
    expect(expectSpanish(r.container, 'cold')).toContain('@tashaR: aún no se han cargado movimientos de Sleeper')
    r.unmount()
    r = render(<TradeWindow state={{ available: true, data: { ...BUYERS, managers: [] } }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/x" nowIso={NOW} />)
    expectSpanish(r.container, 'no buyers')
    r.unmount()
    r = render(<TradeWindow state={{ available: true, data: { ...OWNED, holder: 'other', managers: [] } }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/x" nowIso={NOW} />)
    expect(expectSpanish(r.container, 'nobody')).toContain('No hay a quién proponérselo.')
    r.unmount()
    const src = readFileSync(join(process.cwd(), 'lib/core-app/managerPresence.ts'), 'utf8')
    const presenceReasons = [
      'sign in to see who to pitch', 'league not found', 'no rosters have been imported for this league, so we cannot tell who has him',
      'nobody has him here — he is a free agent, so there is nobody to pitch; claim him', 'the roster that holds him has no team row we can name',
    ]
    for (const reason of [...presenceReasons, coverageReason('yahoo')]) {
      if (presenceReasons.includes(reason)) expect(src, reason).toContain(`'${reason}'`)
      r = render(<TradeWindow state={{ available: false, reason }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/x" nowIso={NOW} />)
      expectSpanish(r.container, reason)
      r.unmount()
    }
  })

  it('every league: the summary, each row, the per-league grade link, the unread note and the pitch button', () => {
    lang.language = 'es'
    const second: ManagerPresence = { ...OWNED, leagueId: 'L-b', leagueName: 'Liga B', platform: 'espn', managers: [mgr({ ownerName: 'riv', window: TUE_EVENINGS, startsHim: false, moves: 9 })] }
    const third: ManagerPresence = { ...OWNED, leagueId: 'L-c', leagueName: 'Liga C', managers: [mgr({ ownerName: 'kim', startsHim: null, moves: 4, lastMove: { at: '2026-10-25T13:58:00.000Z', kind: 'roster_move' } })] }
    const { container } = render(<TradeWindows presences={[second, OWNED, third]} playerName="Dalton Kincaid" pkg={PKG} nowIso={NOW} unread={2} />)
    const out = expectSpanish(container, 'windows')
    expect(out).toContain('1 de 3 dueños están en su ventana ahora mismo.')
    expect(out).toContain('Tiene a Kincaid en la banca en Liga B.')
    expect(out).toContain('Último movimiento: hace 32 min.')
    expect(out).toContain('Calificarlo en Liga B →')
    expect(out).toContain('No se pudo leer la ventana de 2 ligas más donde otro lo tiene.')
    expect(out).toContain('Copiar la propuesta para @tashaR')
    // The order is rankTradeWindows' in both languages: inside the window first.
    expect([...container.querySelectorAll('.af-pf-tw-league')].map((n) => n.textContent)).toEqual(['Gridiron Gang · Sleeper', 'Liga B · ESPN', 'Liga C · Sleeper'])
  })
})

/* ── The value trend ───────────────────────────────────────────────────────────────────────────── */

function series(start: string, values: number[]): TrendPoint[] {
  const t0 = Date.parse(`${start}T00:00:00Z`)
  return values.map((v, i) => ({ day: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10), value: v }))
}
function trend(book: BookTrend['book'], points: TrendPoint[], over: Partial<BookTrend>): BookTrend {
  return {
    book, label: describeValueBook(book), points, value: points[points.length - 1]!.value, lastDay: points[points.length - 1]!.day,
    change7: changeOver(points, 7), change30: changeOver(points, 28), moverShare: 0.93, leagues: 3, yours: 2, ...over,
  }
}

describe('the value trend, in Spanish', () => {
  const DSF = { source: 'FANTASYCALC' as const, format: 'DYNASTY' as const, qbFormat: 'SUPERFLEX' as const }
  const R1 = { source: 'FANTASYCALC' as const, format: 'REDRAFT' as const, qbFormat: 'ONE_QB' as const }
  const up = series('2026-08-30', Array.from({ length: 30 }, (_, i) => 4000 + i * (i > 22 ? 120 : 10)))
  const down = series('2026-09-20', [3000, 2990, 2980, 2970, 2960, 2950, 2940, 2500, 2400])

  for (const [kind, books] of [
    ['sell-high', [trend(DSF, up, {}), trend(R1, down, { yours: 0, leagues: 0, change30: null })]],
    ['check-cause', [trend(R1, down, {})]],
    ['buy-low', [trend(DSF, down, { yours: 0, leagues: 1 })]],
  ] as Array<[string, BookTrend[]]>) {
    it(`books, sparklines, changes, dates and the ${kind} nudge`, () => {
      lang.language = 'es'
      const nudge = nudgeFor(books)
      expect(nudge?.kind).toBe(kind)
      const { container } = render(<ValueTrend data={{ books, nudge, nudgeLocked: false }} access={null} />)
      const out = expectSpanish(container, kind)
      expect(out).toContain('Valor de mercado, últimos 30 días')
      expect(out).toMatch(/de esta tabla\./)
    })
  }

  it('the dates read day-first, and a book with no history says so', () => {
    lang.language = 'es'
    const books = [trend(DSF, up, {}), trend(R1, series('2026-09-27', [100, 110]), { change7: null, change30: null, leagues: 0, yours: 0 })]
    const { container } = render(<ValueTrend data={{ books, nudge: null, nudgeLocked: false }} access={null} />)
    const out = expectSpanish(container, 'dates')
    expect(out).toContain('dinastía · superflex')
    expect(out).toContain('3 de tus ligas · tuyo en 2')
    expect(out).toContain('desde el 31 ago')
    expect(out).toContain('Valor del 30 ago al 28 sep')
    expect(out).toContain('7 días: sin historial suficiente')
    expect(out).toContain('tabla predeterminada: ninguna liga a la vista')
  })
})

/* ── Your shares, and the team split ───────────────────────────────────────────────────────────── */

const SPLIT = buildTeamSplit({
  starters: [
    { sleeperId: '1', name: 'Josh Allen', team: 'BUF', position: 'QB', starts: 3 },
    { sleeperId: '2', name: 'Dalton Kincaid', team: 'BUF', position: 'TE', starts: 2 },
    { sleeperId: '3', name: 'Travis Kelce', team: 'KC', position: 'TE', starts: 1 },
    ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => ({ sleeperId: `x${i}`, name: `P${c}`, team: `T${c}`, position: 'WR', starts: 1 })),
    { sleeperId: '9', name: 'Nadie', team: null, position: 'RB', starts: 2 },
  ],
  byes: { BUF: 12, KC: 10, TA: 12 },
  currentWeek: 8,
  fold: (t) => t,
})
const SHARES: PlayerShares = {
  rows: [
    { player: { sport: 'NFL', externalId: '10236', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null }, leagues: 3, starts: 2, ir: 1, leagueIds: ['a'], status: readiness('Questionable', true), description: null },
    { player: { sport: 'NFL', externalId: '4984', sleeperId: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF', imageUrl: null }, leagues: 1, starts: 1, ir: 0, leagueIds: ['a'], status: readiness('Out', true), description: null },
  ],
  leaguesRead: 4,
  playersHeld: 31,
  unsupportedLeagues: 1,
  teamSplit: SPLIT,
}
const LEAGUE_SHARES: LeagueShareView = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', scoringKnown: true, season: 2026,
  cells: {
    '10236': { holder: { kind: 'you', slot: 'STARTER' }, value: { value: 3200, base: 3010, fitNote: 'TE receptions are worth 1.5 here vs 1 on the chart (+0.5/catch), which is 31% of this position\'s points', mode: 'dynasty', numQbs: 2 }, season: { points: 88.4, games: 7 } },
    '4984': { holder: { kind: 'other', teamName: 'Titanes', ownerName: null }, value: null, season: null },
  },
}

describe('your shares, in Spanish', () => {
  it('every league: the board, the chips, the counts and the team split with its bye call', () => {
    lang.language = 'es'
    expect(SPLIT?.worstBye).toBeTruthy()
    const { container } = render(<PlayerSharesBoard state={{ available: true, data: SHARES }} />)
    const out = expectSpanish(container, 'shares all')
    expect(out).toContain('Tus acciones')
    expect(out).toContain('31 jugadores en 4 plantillas · 1 en una plataforma que aún no podemos leer')
    expect(out).toContain('3 de 4')
    expect(out).toContain('2 titulares · 1 IR')
    expect(out).toContain('De dónde vienen tus titulares')
    expect(out).toContain('La semana 12 es tu mayor descanso por delante:')
  })

  it('one league: who holds each, the value and its scoring note, the season line', () => {
    lang.language = 'es'
    let r = render(<PlayerSharesBoard state={{ available: true, data: SHARES }} league={LEAGUE_SHARES} />)
    const out = expectSpanish(r.container, 'shares league')
    expect(out).toContain('Tus acciones · en Gridiron Gang')
    expect(out).toContain('Tú · titular')
    expect(out).toContain('valor 3,200*')
    expect(out).toContain('88.4 pts · 7 partidos')
    expect(out).toContain('aún sin estadísticas')
    r.unmount()
    r = render(<PlayerSharesBoard state={{ available: true, data: SHARES }} league={{ ...LEAGUE_SHARES, scoringKnown: false }} valuesLocked />)
    expect(expectSpanish(r.container, 'shares locked')).toContain('valor · AF Pro')
    r.unmount()
    for (const holder of [{ kind: 'you', slot: 'BENCH' }, { kind: 'you', slot: 'IR' }, { kind: 'you', slot: 'TAXI' }, { kind: 'free' }, { kind: 'unknown' }, { kind: 'other', teamName: null, ownerName: null }] as const) {
      r = render(<PlayerSharesBoard state={{ available: true, data: SHARES }} league={{ ...LEAGUE_SHARES, cells: { '10236': { holder, value: null, season: null } } }} />)
      expectSpanish(r.container, `holder ${JSON.stringify(holder)}`)
      r.unmount()
    }
  })

  it('every reason the loader gives, and an empty board', () => {
    lang.language = 'es'
    const src = readFileSync(join(process.cwd(), 'lib/core-app/playerShares.ts'), 'utf8')
    for (const reason of ['sign in to see the players you roster most', 'connect a league to see your shares', 'none of your leagues has a claimed team yet']) {
      expect(src, reason).toContain(`'${reason}'`)
      const r = render(<PlayerSharesBoard state={{ available: false, reason }} />)
      expectSpanish(r.container, reason)
      r.unmount()
    }
    const r = render(<PlayerSharesBoard state={{ available: true, data: { ...SHARES, rows: [], teamSplit: null } }} />)
    expectSpanish(r.container, 'empty')
  })
})

/* ── The league in context ─────────────────────────────────────────────────────────────────────── */

const VIEW: PlayerLeagueView = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'sleeper', platformLeagueId: '123456', season: 2026, format: 'guillotine',
  ownership: { kind: 'other', slot: 'STARTER', owner: { teamName: 'Titanes', ownerName: 'tashaR', avatarUrl: null, externalId: '1', record: '4-2', isCommissioner: true } },
  afPoints: { available: true, data: { points: 9.8, matchedKeys: 3, scoredKeys: 12, week: 12, season: '2026' } },
  positionRank: { available: true, data: { rank: 4, outOf: 61, position: 'TE' } },
  yourTeam: { teamName: 'Cafe Con Chimmy', externalId: '2' },
  rosterCount: 12,
  coverage: { sampled: 12, matched: 12, fraction: 1, usable: true },
} as PlayerLeagueView

describe('the league-in-context card, in Spanish', () => {
  it('his owner: the chip, the meta, the actions and the foot', () => {
    lang.language = 'es'
    const { container } = render(<LeagueOwnershipCard view={VIEW} playerName="Dalton Kincaid" />)
    const out = expectSpanish(container, 'other')
    expect(out).toContain('guillotina')
    expect(out).toContain('tashaR · 4-2 · comisionado')
    expect(out).toContain('LO ALINEAN DE TITULAR')
    expect(out).toContain('Intercambiar por Kincaid →')
    expect(out).toContain('Abrir en Sleeper')
    expect(out).toContain('proy. sem. 12 · puntuación de esta liga')
    expect(out).toContain('Solo lectura: el cambio se hace en Sleeper.')
  })

  it('yours, someone unnamed, free, unreadable, and an unpriced projection', () => {
    lang.language = 'es'
    const views: PlayerLeagueView[] = [
      { ...VIEW, format: 'dynasty', ownership: { kind: 'yours', slot: 'BENCH', exactSlot: null, teamName: 'Cafe Con Chimmy' } },
      { ...VIEW, ownership: { kind: 'yours', slot: 'STARTER', exactSlot: 'TE', teamName: null } },
      { ...VIEW, ownership: { kind: 'other', slot: 'IR SLOT', owner: null } },
      { ...VIEW, ownership: { kind: 'free-agent' } },
      { ...VIEW, ownership: { kind: 'unknown', reason: coverageReason('espn') }, afPoints: { available: false, reason: 'no projection week is loaded yet' } },
      { ...VIEW, ownership: { kind: 'unknown', reason: 'no rosters have been imported for this league, so we cannot tell who has him' } },
    ]
    for (const v of views) {
      const { container, unmount } = render(<LeagueOwnershipCard view={v} playerName="Dalton Kincaid" />)
      expectSpanish(container, `${v.ownership.kind} ${JSON.stringify(v.ownership).slice(0, 60)}`)
      unmount()
    }
    const src = readFileSync(join(process.cwd(), 'lib/core-app/playerLeagueView.ts'), 'utf8')
    expect(src).toContain("'no rosters have been imported for this league, so we cannot tell who has him'")
  })
})

/* ── Held to the loaders ───────────────────────────────────────────────────────────────────────── */

describe('the reasons this group translates are the loaders’ own words', () => {
  it('each key is in its loader’s source, verbatim', () => {
    const sources = ['playerTradeVisual.ts', 'managerPresence.ts', 'playerShares.ts', 'playerLeagueView.ts'].map((f) => readFileSync(join(process.cwd(), 'lib/core-app', f), 'utf8')).join('\n')
    for (const key of TRADE_VALUE_REASON_KEYS) {
      // The one built from the shared FOREIGN_IDS_UNREADABLE sentence: its own tail is in the loader.
      const needle = key.includes("can't be matched") ? ", so we can't tell who holds him" : key
      expect(sources, key).toContain(needle)
    }
  })
})

/* ── English is unchanged ──────────────────────────────────────────────────────────────────────── */

describe('English mode is unchanged', () => {
  it('the trade visual, the windows, the trend, the shares and the league card read their English', async () => {
    let r = render(<TradeVisual state={{ available: true, data: VISUAL }} playerName="Dalton Kincaid" />)
    const tv = r.container.textContent ?? ''
    expect(tv).toContain("What it takes to get Kincaid from Titanes")
    expect(tv).toContain('Titanes · @tashaR · rebuilder · needs RB, WR · deep at TE')
    expect(tv).toContain('D · Slightly favors opponent')
    expect(tv).toContain(G_D.available ? G_D.data.recommendation : '')
    expect(tv).toContain('-1,130 market value to you')
    expect(tv).toContain(`Values are AllFantasy market values (dynasty, 1 PPR, superflex). ${SCORING_NOTE} AllFantasy never sends a trade — you send it on Sleeper.`)
    r.unmount()

    const b = bid({ parts: { bid: 'upgrade', sharePct: 23, weekBudget: 400, paced: false, budgetRemaining: 400, weeksAssumed: 1, faabKnown: true } })
    r = render(<TradeVisual state={{ available: true, data: { ...VISUAL, packages: [], recommended: null, tradesAllowed: false, bidInstead: b } }} playerName="Dalton Kincaid" />)
    expect(r.container.querySelector('.af-pf-tv-bidline')?.textContent).toBe('Up to $91 — 23% of the upgrade value on his roster.')
    expect(r.container.textContent).toContain('English as bidFor wrote it')
    r.unmount()

    r = render(<TradeWindow state={{ available: true, data: BUYERS }} playerName="Dalton Kincaid" pkg={null} gradeHref={null} tradeCenterHref="/x" nowIso={NOW} />)
    const lines = [...r.container.querySelectorAll('.af-pf-tw-row')].map((n) => `${n.querySelector('.af-pf-tw-lead')?.textContent}|${n.querySelector('.af-pf-tw-body')?.textContent}`)
    expect(lines).toEqual(BUYERS.managers.map((m) => {
      const l = pitchLine({ presence: BUYERS, manager: m, playerName: 'Dalton Kincaid', now: new Date(NOW), pkg: null })
      return `${l.lead}|${l.body}`
    }))
    fireEvent.click(r.getByRole('button', { name: 'Copy the pitch' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(pitchText({ manager: BUYERS.managers[0]!, playerName: 'Dalton Kincaid', pkg: null })))
    r.unmount()

    const books = [trend({ source: 'FANTASYCALC', format: 'REDRAFT', qbFormat: 'ONE_QB' }, series('2026-09-20', [3000, 2990, 2980, 2970, 2960, 2950, 2940, 2500, 2400]), {})]
    const nudge = nudgeFor(books)!
    r = render(<ValueTrend data={{ books, nudge, nudgeLocked: false }} access={null} />)
    expect(r.container.querySelector('.af-pf-vt-nudge')?.textContent).toBe(`Big drop (redraft · 1QB) ${nudge.text}`)
    expect(r.container.textContent).toContain('month: not enough history')
    r.unmount()

    r = render(<PlayerSharesBoard state={{ available: true, data: SHARES }} league={LEAGUE_SHARES} />)
    expect(r.container.textContent).toContain('31 players across 4 rosters · 1 on a platform we can\'t read yet')
    expect(r.container.textContent).toContain('You · starting')
    r.unmount()
    r = render(<PlayerSharesBoard state={{ available: true, data: SHARES }} />)
    expect(r.container.textContent).toContain('Week 12 is your biggest bye ahead:')
    expect(r.container.textContent).toContain('3 of 42 starting · 1 IR')
    r.unmount()

    r = render(<LeagueOwnershipCard view={VIEW} playerName="Dalton Kincaid" />)
    expect(r.container.textContent).toContain('THEY START HIM')
    expect(r.container.textContent).toContain('Trade for Kincaid →')
    expect(r.container.textContent).toContain('Read-only — the change is made on Sleeper. We show you the league and the screen.')
  })
})
