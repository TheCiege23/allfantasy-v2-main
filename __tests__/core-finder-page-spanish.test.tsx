/**
 * Player Finder's OWN words in Spanish (2026-10-04) — components/core-app/screens/PlayerFinder.tsx:
 * the rail, the header line, the readiness chip, the stat tiles and their "?" tips, the injury block,
 * the league table, the row actions and every empty and error state. The subcomponents #2043 and
 * #2046 translated (GameDayBanner, LockClock, LeagueCalls, SwapCandidates, RecommendedMoves,
 * PlayerVerdict …) render here too and must stay Spanish.
 *
 * ⚠ THE WHOLE PAGE IS SCANNED (2026-10-06). The three subcomponent groups (#2069, #2070, #2071) and the
 * shared AF Pro lock (CoreDepthLock) are Spanish now, so nothing of the app's own is cut out of the
 * scan any more. The one thing still cut is PROVIDER text — see `PROVIDER_TEXT`, which says why for
 * each root. "The whole page" below renders every card the screen can draw — the cross-league view,
 * league mode, compare, the home, and a viewer without AF Pro, whose page is mostly locks — and reads
 * all of it against every group's English vocabulary at once.
 *
 * Every formatter value is REAL output: `readiness`, `byeChip`, `reportedLabel`, `pregameInactive`
 * (through the screen), `describeAge` for the freshness stamp, `scoringFit` for the Value cell's note,
 * snapShare.ts's own reasons. The loader reasons playerFinder.ts / playerLeagueView.ts /
 * playerImpact.ts write are DB-bound, so each one `reasonText` knows is held to its loader's source
 * file verbatim instead — a reworded reason fails here rather than silently going English.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/players',
  useSearchParams: () => new URLSearchParams(),
}))
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

import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import type { PlayerDetail, RecommendedMove } from '@/lib/core-app/playerFinder'
import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import type { PlayerDepth } from '@/lib/core-app/playerDepth'
import { describeAge } from '@/lib/sports-data/freshnessPolicy'
import { scoringFit } from '@/lib/trade-value/scoringFit'
import { NO_SLEEPER_ID_REASON, missingColumnsReason } from '@/lib/core-app/snapShare'
import { FINDER_REASON_KEYS, reasonText } from '@/lib/core-app/playerFinderCopy'
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'
import { reconcileGame, type LiveGameBadge as LiveGameBadgeData } from '@/lib/core-app/liveGameBadge'
import { buildInjuryTimeline } from '@/lib/core-app/injuryTimeline'
import { presenceCells, type DepthChartView } from '@/lib/core-app/depthChart'
import { rankWhoStartsHim, type SellRoster, type WhoStartsHim as WhoStartsHimData } from '@/lib/core-app/whoStartsHim'
import { summarizeSeason, type SeasonWeek } from '@/lib/core-app/playerSeason'
import { mergeNewsItems, type PlayerCardNews } from '@/lib/core-app/playerCard'
import { changeOver, nudgeFor, type BookTrend, type TrendPoint, type ValueTrend as ValueTrendData } from '@/lib/core-app/valueTrend'
import { describeValueBook } from '@/lib/core-app/valueBook'
import type { FreeAgentBids as FreeAgentBidsData } from '@/lib/core-app/freeAgentBids'
import { tradeGradeLabel, tradeGradeRecommendation, type GradeLetter } from '@/lib/decision-os/trade/tradeGrade'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { PlayerTradeVisual, TradeVisualGrade, TradeVisualPackage } from '@/lib/core-app/playerTradeVisual'
import type { ManagerPresence, PresenceManager } from '@/lib/core-app/managerPresence'
import { buildTeamSplit } from '@/lib/core-app/teamSplit'
import type { PlayerShares } from '@/lib/core-app/playerShares'
import type { LeagueShareView } from '@/lib/core-app/playerSharesLeague'
import { readiness } from '@/lib/core-app/playerMoves'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
/**
 * The screen's own English, word by word. League and team names in the fixture avoid every one.
 * "snaps" is not here: the Spanish keeps it ("% de snaps"), as Spanish fantasy coverage does.
 */
const OWN_EN =
  /\b(Search|Player Finder|Matches|Type at least|No player|no position|Compare|Recently|Other matches|Also matched|Stats|Player details|What to do|in this league|All leagues|of your|across|rostered|[Ss]ign in|cross-league|Proj|Projection|Standard|scoring|AF proj|Pos rank|priced|projected|IDP value|Snap share|Offensive|Defensive|games?|Age|birth|Injury|designation|Every platform|Slot|Status|Value|League|This league|value|unconfirmed|Not checked|Trade for|Where to fix|Nothing to do|Bench is right|On IR|No call|unpriced|Season statistics|Pick a match|Ready|Active|Inactive|Questionable|Doubtful|Out|Connect a league|ago|never|adjusted|dynasty|we hold|we have|feed|rank needs|engine|receptions|reported|Bye|No game|Recommended|locked|locks)\b/

/**
 * What is cut out before scanning — PROVIDER TEXT ONLY, each with its reason. Nothing of the app's own
 * words is cut: a card that reads English fails this suite.
 */
const PROVIDER_TEXT: Record<string, string> = {
  // A news headline is the feed's own sentence (ESPN, NewsAPI, Rolling Insights, Sleeper), in the
  // feed's language. PlayerNews prints it verbatim on purpose; translating it would be inventing news.
  '.af-pf-news-title': 'news headlines are the feed’s own English',
}

/**
 * Visible text plus every title, aria-label and placeholder — the reader meets those too. The text is
 * read twice: whole (for phrase assertions) and node by node with a space between, since `textContent`
 * glues neighbouring elements together and a glued word has no ``.
 */
function ownText(container: HTMLElement): string {
  const root = container.cloneNode(true) as HTMLElement
  for (const sel of Object.keys(PROVIDER_TEXT)) root.querySelectorAll(sel).forEach((n) => n.remove())
  const attrs = [...root.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((n) => [
    n.getAttribute('title') ?? '',
    n.getAttribute('aria-label') ?? '',
    n.getAttribute('placeholder') ?? '',
  ])
  const nodes: string[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n.textContent ?? '')
  return [root.textContent ?? '', nodes.join(' '), ...attrs].join(' | ')
}

function expectSpanish(out: string, label: string) {
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  const hit = out.match(OWN_EN)
  expect(hit?.[0] ?? null, `${label}: …${hit ? out.slice(Math.max(0, hit.index! - 60), hit.index! + 60) : ''}…`).toBeNull()
}

/** Open every "?" tip so its body is in the DOM too. */
function openTips(container: HTMLElement) {
  container.querySelectorAll('.af-pf-help-dot').forEach((b) => fireEvent.click(b))
}

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

/* ── The fixture: the handoff's worked example (__tests__/player-finder-screen.test.tsx) ──────────── */

/** Sunday 2026-10-25, 8:00a ET — five hours before Kincaid's 1:00p kickoff. */
const NOW = '2026-10-25T12:00:00.000Z'
const KICKOFF = '2026-10-25T17:00:00.000Z'
const UNPRICED = 'this week’s projection feed does not carry this player'

function impact(over: Partial<LeagueImpact> & Pick<LeagueImpact, 'leagueId' | 'leagueName' | 'platform' | 'slot'>): LeagueImpact {
  return {
    platformLeagueId: null,
    season: 2026,
    exactSlot: null,
    slotConfirmed: true,
    isStarting: over.slot === 'STARTER',
    afPoints: { available: false, reason: UNPRICED },
    replacements: { available: false, reason: 'we could not resolve this player’s position, so we cannot tell who could replace him' },
    startOver: null,
    ...over,
  }
}

const IMPACT: LeagueImpact[] = [
  impact({
    leagueId: 'L-warriors',
    leagueName: 'Gold Coast',
    platform: 'yahoo',
    platformLeagueId: '55',
    slot: 'STARTER',
    exactSlot: 'TE',
    afPoints: { available: true, data: { points: 11.1, matchedKeys: 4, scoredKeys: 20 } },
  }),
  impact({
    leagueId: 'L-dragons',
    leagueName: 'Dragones',
    platform: 'sleeper',
    platformLeagueId: '123456',
    slot: 'BENCH',
    slotConfirmed: false,
    afPoints: { available: true, data: { points: 15.4, matchedKeys: 4, scoredKeys: 30 } },
    startOver: { playerId: 'fergie', name: 'Jake Ferguson', position: 'TE', team: 'DAL', slot: 'FLEX', afPoints: 13.0, delta: 2.4 },
  }),
  impact({ leagueId: 'L-elites', leagueName: 'Oficina FC', platform: 'espn', platformLeagueId: '777', slot: 'IR SLOT' }),
  // Benched, and the bench is right: Ferguson projects higher.
  impact({
    leagueId: 'L-cafe',
    leagueName: 'Cafe Con Chimmy',
    platform: 'sleeper',
    platformLeagueId: '999',
    slot: 'BENCH',
    afPoints: { available: true, data: { points: 9.0, matchedKeys: 4, scoredKeys: 30 } },
    startOver: { playerId: 'fergie', name: 'Jake Ferguson', position: 'TE', team: 'DAL', slot: 'TE', afPoints: 12.0, delta: -3.0 },
  }),
  // Benched with no price: "No call — unpriced".
  impact({ leagueId: 'L-taco', leagueName: 'Taco Tuesday', platform: 'sleeper', platformLeagueId: '444', slot: 'BENCH' }),
]

const CLAIM: RecommendedMove = {
  leagueId: 'L-warriors',
  leagueName: 'Gold Coast',
  platform: 'yahoo',
  projectionWeek: 12,
  affectedProjection: 9.4,
  freeAgents: [{ playerId: '9', name: 'Isaiah Likely', position: 'TE', team: 'BAL', projectedPoints: 12.3, delta: 2.9 }],
  claimTarget: { kind: 'none' },
}

const slot = (leagueId: string, leagueName: string, platform: string, s: string, isYours = true) => ({
  leagueId,
  leagueName,
  platform,
  format: null,
  platformLeagueId: '1',
  season: 2026,
  slot: s,
  isYours,
  owner: null as null | { teamName: string; ownerName: string | null; avatarUrl: string | null; externalId: string },
})

const DETAIL: PlayerDetail = {
  player: {
    externalId: 'ri-1',
    sport: 'NFL',
    sleeperId: '10236',
    name: 'Dalton Kincaid',
    position: 'TE',
    team: 'BUF',
    imageUrl: null,
    number: 86,
    rosteredIn: 5,
    platforms: ['yahoo', 'sleeper', 'espn'],
  },
  identityResolved: true,
  bio: { height: null, weight: null, age: 27, college: 'Utah' },
  // Reported Friday afternoon — `reportedLabel` says "reported Fri 4:00p ET".
  injury: { available: true, data: { status: 'Questionable', description: null, reportedAt: new Date('2026-10-23T20:00:00.000Z') } },
  seasonStats: { available: true, data: [{ season: '2025', stats: { rec: '44', rec_yd: '448' } }] },
  leagues: {
    available: true,
    data: [
      slot('L-warriors', 'Gold Coast', 'yahoo', 'STARTER'),
      slot('L-dragons', 'Dragones', 'sleeper', 'BENCH'),
      slot('L-elites', 'Oficina FC', 'espn', 'IR SLOT'),
      slot('L-cafe', 'Cafe Con Chimmy', 'sleeper', 'BENCH'),
      slot('L-taco', 'Taco Tuesday', 'sleeper', 'BENCH'),
      { ...slot('L-gang', 'Gridiron Gang', 'espn', 'NOT YOURS', false), owner: { teamName: "Tasha's Titans", ownerName: 'tashaR', avatarUrl: null, externalId: '1' } },
      slot('L-pals', 'Los Pals', 'espn', 'NOT YOURS', false),
    ],
  },
  projection: { available: true, data: { points: 13.8, season: '2026', week: 12 } },
  afProjection: { available: true, data: { points: 12.9, season: '2026', week: 12 } },
  game: { available: true, data: { kickoff: KICKOFF, opponent: 'MIA', home: true, week: 12, season: 2026, preseason: false } },
  kickoffs: { BUF: KICKOFF, MIA: KICKOFF, DAL: KICKOFF },
  scheduleWeek: { season: 2026, week: 12 },
  kickoffsUnresolved: 0,
  snapShare: { available: true, data: { share: 0.78, snaps: 400, teamSnaps: 513, games: 8, basis: 'offense' } },
  positionRank: { available: true, data: { rank: 6, outOf: 118, position: 'TE' } },
  impact: { available: true, data: IMPACT },
  recommendedMoves: { available: true, data: [CLAIM] },
  freshness: describeAge('player_bio', new Date(Date.parse(NOW) - 12 * 60_000), new Date(NOW)),
  rosterCoverage: { unmatched: [{ leagueId: 'L-espn2', leagueName: 'Office Pool', platform: 'espn' }] },
} as PlayerDetail

const FIT = scoringFit({ rec: 1, bonus_rec_te: 0.5 } as never, 'TE', 1)!
const DEPTH: PlayerDepth = {
  season: { available: false, reason: 'x' },
  nextGame: { available: false, reason: 'x' },
  upcoming: { available: false, reason: 'x' },
  news: { available: false, reason: 'x' },
  leagueValues: {
    'L-warriors': { value: 5600, base: 5600, fitNote: null, mode: 'dynasty', numQbs: 2 },
    'L-dragons': { value: 6100, base: 5600, fitNote: FIT.reason, mode: 'redraft', numQbs: 1 },
  },
}

const LEAGUE_VIEW: PlayerLeagueView = {
  leagueId: 'L-gang',
  leagueName: 'Gridiron Gang',
  platform: 'espn',
  platformLeagueId: '888',
  season: 2026,
  format: '0.5 PPR',
  ownership: {
    kind: 'other',
    slot: 'STARTER',
    owner: { teamName: "Tasha's Titans", ownerName: 'tashaR', avatarUrl: null, externalId: '1', record: '4-2', isCommissioner: false },
  },
  afPoints: { available: true, data: { points: 9.8, matchedKeys: 3, scoredKeys: 12, week: 12, season: '2026' } },
  positionRank: { available: true, data: { rank: 4, outOf: 61, position: 'TE' } },
  yourTeam: { teamName: 'Cafe Con Chimmy', externalId: '2' },
  rosterCount: 12,
  coverage: { sampled: 12, matched: 12, fraction: 1, usable: true },
}

type Props = React.ComponentProps<typeof PlayerFinder>
function renderFinder(extra: Partial<Props> = {}) {
  return render(<PlayerFinder query="Dalton Kincaid" matches={[DETAIL.player]} detail={DETAIL} leagueCount={6} nowIso={NOW} {...extra} />)
}

/* ── Spanish ─────────────────────────────────────────────────────────────────────────────────────── */

describe('Player Finder — the screen’s own words, in Spanish', () => {
  it('the core view: rail, header line, chip, tiles and tips, injury, the league table and its actions', () => {
    lang.language = 'es'
    const other = { ...DETAIL.player, externalId: 'ri-2', name: 'Dalton Keene', position: null, team: null }
    const { container } = renderFinder({
      matches: [DETAIL.player, other],
      depth: DEPTH,
      recent: [{ sport: 'NFL', externalId: 'ri-9', sleeperId: '9', name: 'Isaiah Likely', position: 'TE', team: 'BAL', searchedAt: new Date(NOW) }],
    })
    openTips(container)
    const out = ownText(container)
    expectSpanish(out, 'core')

    expect(container.querySelector('h1')?.textContent).toBe('Buscar jugadores')
    expect(container.querySelector('.af-pf-rail')?.getAttribute('aria-label')).toBe('Búsqueda')
    expect(out).toContain('Coincidencias · 2')
    expect(out).toContain('sin posición registrada')
    expect(out).toContain('Comparar con Dalton Keene')
    expect(out).toContain('Búsquedas recientes')
    expect(out).toContain('También coinciden')
    expect(out).toContain('Las estadísticas, las lesiones y las noticias vienen de datos deportivos en vivo: nunca un número inventado.')

    // The chip and the header line.
    expect(container.querySelector('.af-pf-name-row .af-pf-ready')?.textContent).toBe('Dudoso')
    expect(container.querySelector('.af-pf-rostered')?.textContent).toBe(' · en 5 de tus 6 ligas, en Yahoo, Sleeper y ESPN · lo tienen otros en 2')
    expect(container.querySelector('.af-sync')?.textContent).toBe('hace 12 min')

    // Tiles.
    const tiles = [...container.querySelectorAll('.af-pf-tile')].map((t) => t.textContent)
    expect(tiles).toEqual([
      expect.stringContaining('13.8Proy. sem. 12'),
      expect.stringContaining('12.9Proy. AF sem. 12'),
      expect.stringContaining('TE6Rango pos.'),
      expect.stringContaining('78%% de snaps'),
      '27Edad',
    ])
    expect(tiles[0]).toContain('Puntuación estándar · 2026')
    expect(tiles[2]).toContain('de 118 TE proyectados')
    expect(tiles[3]).toContain('Snaps ofensivos · 8 partidos')
    expect(out).toContain('es la columna PROY. de la tabla de abajo')

    // Injury.
    expect(out).toContain('Lesión')
    expect(container.querySelector('.af-pf-injury-status')?.textContent).toBe('Dudoso')
    expect(container.querySelector('.af-pf-injury-when')?.textContent).toBe('reportado vie 4:00p ET')

    // The league table.
    expect([...container.querySelectorAll('.af-pf-table th')].map((th) => th.textContent)).toEqual(['Liga', 'Puesto', 'Estado', 'Proy.', 'AF', 'Valor', ''])
    expect(out).toContain('Todas las plataformas, todas las ligas')
    expect(out).toContain('Puesto y estado tal como están ahora')
    const actions = [...container.querySelectorAll('.af-pf-table-action')].map((a) => a.textContent)
    expect(actions).toEqual(
      expect.arrayContaining([
        'Nada que hacer',
        'Dónde corregirlo →',
        'La banca es lo correcto',
        'Sin decisión: sin valorar',
        'Intercambiar por Kincaid →',
      ]),
    )
    expect(out).toContain('Jake Ferguson tiene más proyección en ese puesto')
    expect(out).toContain('el proveedor de proyecciones de esta semana no incluye a este jugador')
    expect(out).toContain('lo tiene @tashaR')
    expect(out).toContain('lo tiene otro mánager')
    expect(out).toContain('puesto sin confirmar')
    expect(out).toContain('valor 6,100')
    expect(out).toContain('ajustado a la puntuación de esta liga')
    expect(out).toContain('dinastía · superflex')
    expect(out).toContain('las recepciones de TE valen 1.5 aquí frente a 1 en la tabla de mercado (+0.5 por recepción)')
    const slots = [...container.querySelectorAll('.af-pf-slot')].map((s) => s.textContent)
    expect(slots).toEqual(['BANCA', 'PUESTO IR', 'BANCA', 'BANCA', 'TE', 'NO ES TUYO', 'NO ES TUYO'])
    expect(out).toContain(
      'Sin comprobar: Office Pool. Sus plantillas usan ids de jugador de ESPN que todavía no emparejamos con nuestra tabla de jugadores.',
    )
    expect(out).toContain('Estadísticas de temporada')
    expect(container.querySelector('.af-pf-side')?.getAttribute('aria-label')).toBe('Qué hacer')
    expect(container.querySelector('.af-pf-main')?.getAttribute('aria-label')).toBe('Detalles del jugador')
  })

  it('league mode: the league’s own tiles, the held row and the way back', () => {
    lang.language = 'es'
    const { container } = renderFinder({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW })
    openTips(container)
    const out = ownText(container)
    expectSpanish(out, 'league')
    expect(container.querySelector('.af-pf-rostered')?.textContent).toBe(' · en Gridiron Gang · Todas las ligas →')
    expect(out).toContain('Proy. sem. 12')
    expect(out).toContain('Puntuación de Gridiron Gang')
    expect(out).toContain('de 61 TE valorados · puntuación de esta liga')
    expect(out).toContain('Puntos esperados esta semana con la puntuación propia de esta liga, no un ranking genérico.')
    expect(out).toContain('ajustado a la puntuación de esta liga. La casilla de al lado')
    expect(out).toContain('En esta liga')
    expect(out).toContain('Puesto y estado aquí ·')
    expect(out).toContain('Esta liga')
  })

  it('league mode, no tile data and no row: the league’s own reasons', () => {
    lang.language = 'es'
    const view: PlayerLeagueView = {
      ...LEAGUE_VIEW,
      afPoints: { available: false, reason: 'we hold no scoring settings for this league, and a generic projection would not be this league’s' },
      positionRank: { available: false, reason: 'a rank needs this player priced under this league’s scoring first' },
    }
    const { container } = renderFinder({
      selectedLeagueId: 'L-nowhere',
      leagueView: { ...view, leagueId: 'L-nowhere', leagueName: 'Nowhere' },
    })
    const out = ownText(container)
    expectSpanish(out, 'league, empty')
    expect(out).toContain('Proy. esta semana')
    expect(out).toContain('no tenemos las reglas de puntuación de esta liga, y una proyección genérica no sería la de esta liga')
    expect(out).toContain('un rango necesita primero valorar a este jugador con la puntuación de esta liga')
    expect(out).toContain('No está en ninguna plantilla que podamos leer en esta liga.')
  })

  it('every section unavailable, each with its loader’s own reason', () => {
    lang.language = 'es'
    const detail: PlayerDetail = {
      ...DETAIL,
      player: { ...DETAIL.player, sleeperId: null },
      bio: { ...DETAIL.bio, age: null },
      injury: { available: false, reason: 'no injury designation on file — which is not the same as healthy' },
      seasonStats: { available: false, reason: 'no season statistics ingested for this player' },
      leagues: { available: false, reason: 'we have no platform id for this player, so we cannot tell which of your leagues roster him' },
      projection: { available: false, reason: 'we hold no Sleeper id for this player, and the projection feed is keyed by one' },
      afProjection: { available: false, reason: 'we hold no Sleeper id for this player, and AllFantasy’s projections are keyed by one' },
      positionRank: { available: false, reason: 'a rank needs this player to appear in the projection set, and he does not' },
      snapShare: { available: false, reason: NO_SLEEPER_ID_REASON },
      impact: { available: false, reason: 'we hold no Sleeper id for this player, so we cannot locate him on your rosters' },
      freshness: describeAge('player_bio', null),
    } as PlayerDetail
    const { container, unmount } = renderFinder({ detail })
    const out = ownText(container)
    expectSpanish(out, 'unavailable')
    expect(out).toContain('Proy. esta semana')
    expect(out).toContain('Proy. AF')
    expect(out).toContain('sin fecha de nacimiento registrada')
    expect(out).toContain('no hay designación de lesión registrada, que no es lo mismo que sano')
    expect(out).toContain('no hay estadísticas de temporada cargadas para este jugador')
    expect(out).toContain('no tenemos un id de plataforma para este jugador, así que no podemos saber cuáles de tus ligas lo tienen')
    expect(out).toContain('no tenemos el id de Sleeper de este jugador, y los registros de partidos se identifican por ese id')
    expect(out).toContain(' · la búsqueda entre ligas no está disponible')
    expect(container.querySelector('.af-sync')?.textContent).toBe('⚠ nunca')
    unmount()

    // The snap-share reason for a player we hold an id for, and an injury name we will not guess at.
    const r2 = renderFinder({
      detail: {
        ...DETAIL,
        snapShare: { available: false, reason: missingColumnsReason('off_snp', 'tm_off_snp') },
        injury: {
          available: false,
          reason: 'more than one NFL player is named Dalton Kincaid, and the injury feed carries no id to tell them apart — so we will not guess',
        },
      } as PlayerDetail,
    })
    const out2 = ownText(r2.container)
    expectSpanish(out2, 'unavailable 2')
    expect(out2).toContain('ningún partido registrado tiene off_snp y tm_off_snp a la vez para este jugador')
    expect(out2).toContain('hay más de un jugador de NFL llamado Dalton Kincaid')
  })

  it('a defender’s IDP tile and its tip', () => {
    lang.language = 'es'
    const detail = {
      ...DETAIL,
      player: { ...DETAIL.player, position: 'LB' },
      idpValue: { value: 3284, positionRank: 4, reference: { numTeams: 12, idpStarters: 3 } },
      snapShare: { available: true, data: { share: 0.9, snaps: 500, teamSnaps: 555, games: 1, basis: 'defense' } },
    } as unknown as PlayerDetail
    const { container } = renderFinder({ detail })
    openTips(container)
    const out = ownText(container)
    expectSpanish(out, 'idp')
    expect(out).toContain('Valor IDP')
    expect(out).toContain('puesto 4 · 12 equipos · 3 IDP')
    expect(out).toContain('12 equipos, 3 titulares IDP, con el perfil de puntuación IDP predeterminado.')
    expect(out).toContain('Snaps defensivos · 1 partido')
  })

  it('every designation on the chip, and the pregame Inactive', () => {
    lang.language = 'es'
    const want: Record<string, string> = { Active: 'Listo', Questionable: 'Dudoso', Doubtful: 'Poco probable', Out: 'Fuera', Suspended: 'Suspendido' }
    for (const [status, es] of Object.entries(want)) {
      const { container, unmount } = renderFinder({
        detail: { ...DETAIL, injury: { available: true, data: { status, description: null, reportedAt: null } } } as PlayerDetail,
      })
      expect(container.querySelector('.af-pf-name-row .af-pf-ready')?.textContent, status).toBe(es)
      expect(container.querySelector('.af-pf-injury-status')?.textContent, status).toBe(status === 'Active' ? 'Activo' : es)
      expectSpanish(ownText(container), status)
      // Ruled out on an IR slot: no move, and the row says IR is right.
      if (status === 'Out') {
        expect([...container.querySelectorAll('.af-pf-table-action')].map((a) => a.textContent)).toContain('En IR: ningún reporte dice lo contrario')
      }
      unmount()
    }
    // Ruled out 30 minutes before his kickoff: the inactive list.
    const { container } = renderFinder({
      detail: { ...DETAIL, injury: { available: true, data: { status: 'Out', description: null, reportedAt: new Date('2026-10-25T16:30:00.000Z') } } } as PlayerDetail,
    })
    expect(container.querySelector('.af-pf-name-row .af-pf-ready')?.textContent).toBe('Inactivo')
    expect(container.querySelector('.af-pf-status')?.textContent).toBe('Inactivo')
  })

  it('the not-playing chip: a bye, and no game on the schedule', () => {
    lang.language = 'es'
    // 28 clubs on the slate in week 12 and Buffalo not among them: `byeStatus` reads a bye.
    const slate = Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`C${i}`, KICKOFF]))
    const bye = renderFinder({ detail: { ...DETAIL, game: { available: false, reason: 'x' }, kickoffs: slate } as PlayerDetail })
    expect(bye.container.querySelector('.af-pf-bye')?.textContent).toBe('Descanso · sem. 12')
    expectSpanish(ownText(bye.container), 'bye')
    bye.unmount()
    const none = renderFinder({ detail: { ...DETAIL, game: { available: false, reason: 'x' }, kickoffs: { MIA: KICKOFF, DAL: KICKOFF } } as PlayerDetail })
    expect(none.container.querySelector('.af-pf-bye')?.textContent).toBe('Sin partido en el calendario')
    expectSpanish(ownText(none.container), 'no game')
  })

  it('signed out: the locked door, in Spanish', () => {
    lang.language = 'es'
    const { container } = renderFinder({ signedIn: false, matches: [] })
    const out = ownText(container)
    expectSpanish(out, 'signed out')
    expect(out).toContain(
      'Inicia sesión para ver cuáles de tus ligas lo tienen, en qué puesto está y cuánto vale con la puntuación propia de cada liga.',
    )
    expect(out).toContain('Conecta una liga: es gratis')
    expect(out).toContain(' · inicia sesión para verlo en todas tus ligas')
    expect(container.querySelector('.af-pf-matches')).toBeNull()
  })

  it('empty states: no player open, too short a query, no match, no roster', () => {
    lang.language = 'es'
    for (const [query, want] of [
      ['K', 'Escribe al menos dos caracteres para buscar.'],
      ['Zzz', 'Ningún jugador coincide con «Zzz».'],
    ] as const) {
      const { container, unmount } = render(<PlayerFinder query={query} matches={[]} detail={null} leagueCount={6} nowIso={NOW} />)
      const out = ownText(container)
      expectSpanish(out, query)
      expect(out).toContain(want)
      expect(out).toContain('Coincidencias · 0')
      // Signed in with no player open, the home leads with "Mis jugadores" instead of the
      // "pick a match" card (2026-10-08, "My players").
      expect(out).toContain('Mis jugadores')
      expect(out).not.toContain('Elige una coincidencia para ver puestos, lesión e historial de temporadas.')
      unmount()
    }
    for (const count of [1, 4]) {
      const { container, unmount } = renderFinder({
        leagueCount: count,
        detail: { ...DETAIL, leagues: { available: true, data: [] }, impact: { available: true, data: [] } } as PlayerDetail,
      })
      const out = ownText(container)
      expectSpanish(out, `no roster ${count}`)
      expect(out).toContain(
        count === 1 ? 'No está en ninguna plantilla de la liga que conectaste.' : 'No está en ninguna plantilla de las 4 ligas que conectaste.',
      )
      expect(container.querySelector('.af-pf-rostered')?.textContent).toBe(count === 1 ? ' · no está en tu única liga' : ' · no está en ninguna de tus 4 ligas')
      unmount()
    }
  })
})

/* ── The whole page: every card the screen can draw, read at once ──────────────────────────────── */

/**
 * Every group's English at once: the screen's own (`OWN_EN`), the player-info cards' (#2069), the
 * search-and-leagues pieces' (#2070), the trade-and-value cards' (#2071), the AF Pro lock's, and the
 * plain words any English sentence carries. Kept in the Spanish on purpose, and so absent: PPR, FAAB,
 * IR, TE/RB/WR/QB, superflex, 1QB, best ball, p75, pts, vs, snaps, "Waiver Intel", AF Pro / AF
 * Commissioner, AllFantasy and the platform names.
 */
const WHOLE_EN = new RegExp(
  `\\b(${[
    // plain English
    'the', 'and', 'your', 'you', 'with', 'from', 'this', 'that', 'is', 'are', 'to', 'in', 'on', 'for', 'of', 'his', 'he', 'who', 'what', 'when', 'which', 'would', 'here',
    // the AF Pro lock and its note
    'part of', 'not included', 'Upgrade', 'the rest', 'See', 'Free until', 'then', 'stay free',
    // #2069 — live badge, injury chip, depth chart, who'd start him, season, news
    'Live', 'Week', 'week', 'starting', 'bench', 'updated', 'ago', 'just now', 'Improved', 'Worse', 'Was', 'reported', 'Next man up', 'Yours', 'Free', 'Taken',
    'leagues?', "Can't read", 'Claim', 'Depth', 'this player', 'Who plays', 'Which teams', 'would start', 'teams?', 'more', 'Open', 'Trade Center', 'Ranked',
    'market value', 'This season', 'scoring', 'Points', 'Per game', 'Games', 'Best', 'wk', 'scored', 'projected', 'Wk', 'Opp', 'Proj', 'Scored', 'no stats', 'News',
    // #2070 — search box, compare, picker, strip, sticky bar, FA bids
    'Search', 'Compare', 'Suggestions', 'no team', 'on file', 'Swap', 'Clear', 'Side by side', 'Neither', 'Across', 'League', 'Leagues', 'All', 'None', 'Save',
    'selected', 'Filter', 'available', 'Available', 'elsewhere', 'START', 'BENCH', 'FA', 'Free agent', 'Bid', 'left', 'winning', 'median', 'claims?', 'bids',
    // #2071 — trade visual, trade windows, value trend, shares, team split, league card
    'Trade', 'trades?', 'bid', 'upgrade', 'lineup', 'Up to', 'budget', 'package', 'packages', 'needs', 'deep', 'give', 'get', 'Nothing', 'market', 'value', 'Values',
    'Grade', 'Other', 'Send', 'never', 'window', 'windows', 'move', 'moves', 'moved', 'reachable', 'usually', 'pitch', 'Pitch', 'Copy', 'owners?', 'soonest',
    'Market', 'days', 'since', 'month', 'history', 'Sell-high', 'Buy-low', 'Big drop', 'shares', 'players', 'rosters?', 'Another', 'readable', 'stats', 'starters',
    'slots?', 'clubs?', 'bye', 'Bye', 'roster', 'commissioner', 'THEY', 'THEIR', 'Unrostered', 'proj', 'Read-only', 'Even', 'Slightly', 'favors', 'Favors',
    'dynasty', 'evenings',
  ].join('|')})\\b`,
)

function expectWholeSpanish(out: string, label: string) {
  expect(out.length, label).toBeGreaterThan(200)
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  for (const re of [OWN_EN, WHOLE_EN]) {
    const hit = out.match(re)
    expect(hit?.[0] ?? null, `${label}: …${hit ? out.slice(Math.max(0, hit.index! - 70), hit.index! + 70) : ''}…`).toBeNull()
  }
}

/** "Most added this week" (trendingAdds.ts): one row that links, one whose ref did not round-trip. */
const TRENDING = {
  rows: [
    { sleeperId: '1339', name: 'Zach Ertz', position: 'TE', team: 'PHI', imageUrl: null, ref: 'NFL:E1339', leagues: 66 },
    { sleeperId: '8150', name: 'Kendre Miller', position: 'RB', team: 'NO', imageUrl: null, ref: null, leagues: 41 },
  ],
  activeLeagues: 189,
  through: '2026-09-28T14:59:00.000Z',
}

const STARTS = new Date('2026-10-15T04:00:00.000Z')
/** Before launch, without the plan: every card open, each with its "Free until" note. */
const PRE_LAUNCH = decideCoreDepth('player_depth', { live: false, startsAt: STARTS, hasPlan: false })
/** After launch, without the plan: the page a free reader gets — locks. */
const FREE_READER = decideCoreDepth('player_depth', { live: true, startsAt: STARTS, hasPlan: false })

const PICK_LEAGUES = [
  { id: 'L-warriors', name: 'Gold Coast', platform: 'yahoo' },
  { id: 'L-dragons', name: 'Dragones', platform: 'sleeper' },
  { id: 'L-elites', name: 'Oficina FC', platform: 'espn' },
  { id: 'L-cafe', name: 'Cafe Con Chimmy', platform: 'sleeper' },
  { id: 'L-taco', name: 'Taco Tuesday', platform: 'sleeper' },
  { id: 'L-gang', name: 'Gridiron Gang', platform: 'espn' },
  { id: 'L-pals', name: 'Los Pals', platform: 'espn' },
]

/** His game, kicked off 90 minutes before the page's clock: live, scored in two leagues. */
const LIVE_KICK = new Date(Date.parse(NOW) - 90 * 60_000).toISOString()
const LIVE: LiveGameBadgeData = {
  game: reconcileGame({
    club: 'BUF',
    rows: [{ homeTeam: 'BUF', awayTeam: 'MIA', homeScore: 14, awayScore: 10, status: 'in_progress', startTime: LIVE_KICK, seasonType: null, week: 12, updatedAt: NOW }],
    now: new Date(NOW),
    fold: (t) => t,
  })!,
  leagues: [
    { leagueId: 'L-warriors', leagueName: 'Gold Coast', points: 12.4, isStarter: true, updatedAt: new Date(Date.parse(NOW) - 4 * 60_000).toISOString(), finalized: false },
    { leagueId: 'L-dragons', leagueName: 'Dragones', points: 3.1, isStarter: false, updatedAt: NOW, finalized: false },
  ],
}

const TIMELINE = buildInjuryTimeline({
  rows: [
    { status: 'Out', date: new Date('2026-10-12T15:00:00Z'), fetchedAt: new Date('2026-10-12T15:00:00Z'), source: 'espn', returnDate: null },
    { status: 'Questionable', date: new Date('2026-10-23T15:00:00Z'), fetchedAt: new Date('2026-10-23T15:00:00Z'), source: 'espn', returnDate: '2026-10-26' },
  ],
  current: { status: 'Questionable', reportedAt: new Date('2026-10-23T20:00:00.000Z') },
  now: new Date(NOW),
})

const claimLinkFor = (leagueId: string) => ({ href: `https://sleeper.com/leagues/${leagueId}/players`, label: 'Open in Sleeper', platformLabel: 'Sleeper', screen: 'Players', external: true })
const held = (leagueId: string, s: string, isYours: boolean, owner: string | null = null) => ({ leagueId, slot: s, isYours, owner: owner ? { teamName: owner } : null }) as never
const DC_LEAGUES = PICK_LEAGUES.map(({ id, name }) => ({ id, name }))
const DEPTH_CHART: DepthChartView = {
  team: 'BUF',
  slot: 'TE',
  asOfIso: '2026-10-22T10:00:00.000Z',
  hisDepth: 1,
  entries: [
    { depth: 1, name: 'Dalton Kincaid', sleeperId: '10236', ref: 'NFL:ri-1', isHim: true },
    { depth: 2, name: 'Dawson Knox', sleeperId: 'S2', ref: 'NFL:E2', isHim: false },
    { depth: 3, name: 'Quintin Morris', sleeperId: 'S3', ref: null, isHim: false },
  ],
  presence: {
    S2: presenceCells(DC_LEAGUES, [held('L-warriors', 'STARTER', true), held('L-dragons', 'BENCH', true), held('L-gang', 'NOT YOURS', false, 'Titanes')], [{ leagueId: 'L-pals' }], claimLinkFor),
    S3: presenceCells(DC_LEAGUES, [held('L-elites', 'IR SLOT', true), held('L-cafe', 'TAXI', true)], [], claimLinkFor),
  },
}

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN']
const sellRoster = (key: string, te: [number, number], teamName: string): SellRoster => ({
  key,
  teamName,
  players: [
    { id: `${key}qb`, name: `Rojas ${key}`, position: 'QB', value: 60 },
    { id: `${key}rb1`, name: `Mora ${key}1`, position: 'RB', value: 50 },
    { id: `${key}rb2`, name: `Mora ${key}2`, position: 'RB', value: 45 },
    { id: `${key}wr1`, name: `Vega ${key}1`, position: 'WR', value: 50 },
    { id: `${key}wr2`, name: `Vega ${key}2`, position: 'WR', value: 45 },
    { id: `${key}te1`, name: `Soto ${key}1`, position: 'TE', value: te[0] },
    { id: `${key}te2`, name: `Soto ${key}2`, position: 'TE', value: te[1] },
  ],
})
function whoStarts(): WhoStartsHimData {
  const others = [sellRoster('A', [10, 5], 'Titanes'), sellRoster('B', [30, 20], 'Leones'), sellRoster('C', [90, 80], 'Halcones')]
  const { teams } = rankWhoStartsHim({ him: { id: 'him', position: 'TE', value: 40 }, others, slots: SLOTS })
  return {
    leagues: [
      { leagueId: 'L-warriors', leagueName: 'Gold Coast', state: 'ranked', note: null, teams, otherTeams: others.length },
      { leagueId: 'L-taco', leagueName: 'Taco Tuesday', state: 'unmeasured', note: 'this league’s lineup is not on file', teams: [], otherTeams: 0 },
    ],
    locked: false,
  }
}

const WEEKS: SeasonWeek[] = [
  { week: 9, opponent: 'ARI', projected: 11.2, actual: 14.3, played: true },
  { week: 10, opponent: 'NYJ', projected: 10.0, actual: 6.1, played: true },
  { week: 11, opponent: null, projected: null, actual: null, played: false },
]
const NEWS: PlayerCardNews[] = mergeNewsItems(
  [
    { title: 'Kincaid limited at practice with a knee issue', source: 'espn', url: 'https://x/1', publishedAt: new Date(Date.parse(NOW) - 40 * 60_000).toISOString() },
    { title: 'Bills tight end outlook for Sunday', source: 'newsapi_sports', url: 'https://x/2', publishedAt: new Date(Date.parse(NOW) - 5 * 3_600_000).toISOString() },
  ],
  [{ title: 'Kincaid returned to a full practice', source: 'sleeper_live', url: null, publishedAt: '2026-10-19T14:00:00.000Z' }],
  null,
)
const FULL_DEPTH: PlayerDepth = {
  ...DEPTH,
  season: { available: true, data: { season: 2026, scoring: { kind: 'ppr' }, weeks: WEEKS, summary: summarizeSeason(WEEKS) } },
  news: { available: true, data: NEWS },
}

function trendSeries(start: string, values: number[]): TrendPoint[] {
  const t0 = Date.parse(`${start}T00:00:00Z`)
  return values.map((v, i) => ({ day: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10), value: v }))
}
function valueTrend(nudgeLocked: boolean): ValueTrendData {
  const points = trendSeries('2026-09-26', Array.from({ length: 30 }, (_, i) => 4000 + i * (i > 22 ? 120 : 10)))
  const DSF = { source: 'FANTASYCALC' as const, format: 'DYNASTY' as const, qbFormat: 'SUPERFLEX' as const }
  const book: BookTrend = {
    book: DSF, label: describeValueBook(DSF), points, value: points[points.length - 1]!.value, lastDay: points[points.length - 1]!.day,
    change7: changeOver(points, 7), change30: changeOver(points, 28), moverShare: 0.93, leagues: 3, yours: 2,
  }
  const nudge = nudgeFor([book])
  expect(nudge?.kind).toBe('sell-high')
  return nudgeLocked ? { books: [book], nudge: null, nudgeLocked: true } : { books: [book], nudge, nudgeLocked: false }
}

const FA_BIDS: FreeAgentBidsData = {
  bidsLocked: false,
  rows: [
    { leagueId: 'L-pals', leagueName: 'Los Pals', platform: 'espn', claim: claimLinkFor('L-pals'), bid: { amount: 23, budget: 100, remaining: 61 }, room: { claims: 14, median: 9, p75: 17 }, note: null },
    { leagueId: 'L-taco', leagueName: 'Taco Tuesday', platform: 'sleeper', claim: claimLinkFor('L-taco'), bid: null, room: null, note: 'waiver-priority league — no FAAB bid' },
  ],
}
const FA_BIDS_LOCKED: FreeAgentBidsData = { bidsLocked: true, rows: FA_BIDS.rows.map((r) => ({ ...r, bid: null, room: null, note: null })) }

const TV_GRADE = (letter: GradeLetter, giveValue: number, getValue: number, pct: number): SectionState<TradeVisualGrade> => ({
  available: true,
  data: { letter, partnerLetter: letter, label: tradeGradeLabel(pct).label, recommendation: tradeGradeRecommendation({ letter, giveValue, getValue }), giveValue, getValue, basis: 'Keeper · 1QB · 12 teams · Half PPR' },
})
const KINCAID_ASSET = { kind: 'player' as const, playerId: '10236', name: 'Dalton Kincaid', position: 'TE', value: 3010 }
const POLLARD = { kind: 'player' as const, playerId: 'rb3', name: 'Tony Pollard', position: 'RB', value: 3140 }
const PKG_1: TradeVisualPackage = {
  id: 'p1', give: [POLLARD], receive: [KINCAID_ASSET], giveTotal: 3140, receiveTotal: 3010, delta: -1130, fairness: 'balanced', confidence: 85,
  reasons: ['Target player is on the trade block'], warnings: [], grade: TV_GRADE('D', 3140, 2610, -17),
}
const VISUAL: PlayerTradeVisual = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'espn', platformLeagueId: '888', season: 2026,
  target: { sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', value: 3010 },
  you: { teamName: 'Cafe Con Chimmy', ownerName: 'guap', externalId: '2', stance: 'contender', stanceSettled: true, needs: ['TE'], surpluses: ['RB'] },
  partner: { teamName: "Tasha's Titans", ownerName: 'tashaR', externalId: '1', stance: 'rebuilder', stanceSettled: true, needs: ['RB'], surpluses: ['TE'] },
  values: { mode: 'dynasty', source: 'fantasycalc', fetchedAt: '2026-10-20T12:00:00Z', ppr: 1, numQbs: 2, scoringAdjustment: null },
  bidInstead: null,
  packages: [PKG_1],
  recommended: PKG_1,
  grade: PKG_1.grade,
}

const SUN_MORNING = { weekday: 0, startHour: 8, endHour: 10, daypart: 'morning' as const, precision: 'window' as const, share: 0.8, sample: 12, zone: 'ET' }
const presenceMgr = (over: Partial<PresenceManager>): PresenceManager => ({
  role: 'owner', teamName: "Tasha's Titans", ownerName: 'tashaR', avatarUrl: null, externalId: '1', record: '4-2', rank: 3,
  need: null, startsHim: true, window: SUN_MORNING, lastMove: { at: '2026-10-25T11:00:00.000Z', kind: 'waiver' }, moves: 13, ...over,
})
const PRESENCE: ManagerPresence = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'espn', platformLeagueId: '888', season: 2026,
  timeZone: 'America/New_York', zone: 'ET', player: { sleeperId: '10236', position: 'TE' }, holder: 'other',
  managers: [presenceMgr({})], activityIngested: true, newestMove: '2026-10-25T11:00:00.000Z', unattributed: 1,
}
const PRESENCE_2: ManagerPresence = { ...PRESENCE, leagueId: 'L-pals', leagueName: 'Los Pals', managers: [presenceMgr({ ownerName: 'riv', externalId: '3', startsHim: false, window: null, moves: 4 })] }

const SPLIT = buildTeamSplit({
  starters: [
    { sleeperId: '1', name: 'Josh Allen', team: 'BUF', position: 'QB', starts: 3 },
    { sleeperId: '10236', name: 'Dalton Kincaid', team: 'BUF', position: 'TE', starts: 2 },
    { sleeperId: '3', name: 'Travis Kelce', team: 'KC', position: 'TE', starts: 1 },
    { sleeperId: '9', name: 'Nadie', team: null, position: 'RB', starts: 1 },
  ],
  byes: { BUF: 13, KC: 14 },
  currentWeek: 12,
  fold: (t) => t,
})
const SHARES: PlayerShares = {
  rows: [
    { player: { sport: 'NFL', externalId: 'ri-1', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null }, leagues: 3, starts: 2, ir: 1, leagueIds: ['L-warriors'], status: readiness('Questionable', true), description: null },
    { player: { sport: 'NFL', externalId: 'ri-2', sleeperId: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF', imageUrl: null }, leagues: 1, starts: 1, ir: 0, leagueIds: ['L-warriors'], status: readiness('Active', true), description: null },
  ],
  leaguesRead: 6,
  playersHeld: 31,
  unsupportedLeagues: 1,
  teamSplit: SPLIT,
}
const LEAGUE_SHARES: LeagueShareView = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', scoringKnown: true, season: 2026,
  cells: {
    '10236': { holder: { kind: 'you', slot: 'STARTER' }, value: { value: 3200, base: 3010, fitNote: null, mode: 'dynasty', numQbs: 2 }, season: { points: 88.4, games: 7 } },
    '4984': { holder: { kind: 'other', teamName: "Tasha's Titans", ownerName: null }, value: null, season: null },
  },
}

const COMPARE_B = {
  ...DETAIL,
  player: { ...DETAIL.player, externalId: 'ri-7', sleeperId: '4993', name: 'Jake Ferguson', team: 'DAL' },
} as PlayerDetail

function wholePage(extra: Partial<Props>) {
  const { container } = renderFinder({
    detail: { ...DETAIL, injuryTimeline: TIMELINE } as PlayerDetail,
    depth: FULL_DEPTH,
    pickLeagues: PICK_LEAGUES,
    liveGame: LIVE,
    depthChart: DEPTH_CHART,
    whoStartsHim: whoStarts(),
    valueTrend: valueTrend(false),
    freeAgentBids: FA_BIDS,
    depthAccess: PRE_LAUNCH,
    ...extra,
  })
  openTips(container)
  return container
}

/** Every root the three groups and the lock own; each must be ON the page the scan reads. */
function expectDrawn(container: HTMLElement, roots: string[], label: string) {
  for (const sel of roots) expect(container.querySelector(sel), `${label}: ${sel} is not on the page`).not.toBeNull()
}

describe('Player Finder — the whole page, in Spanish', () => {
  it('the cross-league view: live badge, injury chip, strip, news, every right-hand card, the windows and the "Free until" notes', () => {
    lang.language = 'es'
    const container = wholePage({ windows: [PRESENCE, PRESENCE_2], windowsUnread: 1 })
    expectDrawn(
      container,
      ['section.af-pf-live', 'span.af-pf-injtl', 'form.af-pf-search-wrap', 'div.af-pf-strip', 'section.af-pf-news', 'section.af-pf-dc', 'section.af-pf-ws', 'section.af-pf-season-card', '.af-pf-vt', 'section.af-pf-fa', '.af-pf-tw--multi', '.af-core-free-until'],
      'core',
    )
    // The headline is cut as provider text — and must still come through untouched.
    expect(container.querySelector('.af-pf-news-title')?.textContent).toBe('Kincaid limited at practice with a knee issue')
    const out = ownText(container)
    expectWholeSpanish(out, 'core')
    expect(out).toContain('Gratis hasta el 15 de octubre — luego, AF Pro')
    expect(out).toContain('Reclamar a Knox en Sleeper')
    expect(out).toContain('Reclamar a Kincaid en Sleeper')
  })

  it('league mode, someone else has him: the league card, the sticky bar, the trade visual and the window', () => {
    lang.language = 'es'
    const container = wholePage({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW, tradeVisual: { available: true, data: VISUAL }, presence: { available: true, data: PRESENCE } })
    expectDrawn(container, ['.af-pf-lv', 'div.af-pf-stickybar', '.af-pf-tv', '.af-pf-tw'], 'league')
    const out = ownText(container)
    expectWholeSpanish(out, 'league')
    expect(out).toContain('Intercambiar por Kincaid')
  })

  it('compare: the side-by-side card', () => {
    lang.language = 'es'
    const container = wholePage({ compare: COMPARE_B, query: 'Dalton Kincaid' })
    expectDrawn(container, ['section.af-pf-cmp'], 'compare')
    expectWholeSpanish(ownText(container), 'compare')
  })

  it('the home: the league picker and your shares with the team split', () => {
    lang.language = 'es'
    const { container } = renderFinder({ detail: null, matches: [], pickLeagues: PICK_LEAGUES, shares: { available: true, data: SHARES }, depthAccess: PRE_LAUNCH })
    openTips(container)
    expectDrawn(container, ['div.af-pf-picker', '.af-pf-shares', '.af-pf-split'], 'home')
    expectWholeSpanish(ownText(container), 'home')
    const league = renderFinder({ detail: null, matches: [], selectedLeagueId: 'L-gang', shares: { available: true, data: SHARES }, leagueShares: LEAGUE_SHARES, depthAccess: PRE_LAUNCH })
    expectWholeSpanish(ownText(league.container), 'home, one league')
  })

  it('the home: "Most added this week" in the rail — heading, the freshness line and each row’s count', () => {
    lang.language = 'es'
    const { container } = renderFinder({ detail: null, matches: [], trendingAdds: TRENDING })
    expectDrawn(container, ['section.af-pf-trend'], 'trending adds')
    const card = container.querySelector('section.af-pf-trend') as HTMLElement
    expectWholeSpanish(ownText(container), 'home, trending adds')
    expect(card.querySelector('h2')?.textContent).toBe('Los más añadidos esta semana')
    expect(card.querySelector('.af-pf-trend-sub')?.textContent).toBe('de 189 ligas con altas · hasta el 28 sep')
    expect([...card.querySelectorAll('.af-pf-trend-count')].map((n) => n.getAttribute('aria-label'))).toEqual(['añadido en 66 ligas', 'añadido en 41 ligas'])
    // Only the words follow the language: the count, the link and the row that cannot link do not.
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/core/players?q=Zach%20Ertz&player=NFL%3AE1339')
    expect(card.querySelectorAll('a')).toHaveLength(1)
    expect([...card.querySelectorAll('.af-pf-trend-count')].map((n) => n.textContent)).toEqual(['+66', '+41'])
  })

  it('a viewer without AF Pro: every lock on the page reads Spanish, and nothing paid is drawn', () => {
    lang.language = 'es'
    const container = wholePage({
      depthAccess: FREE_READER,
      selectedLeagueId: 'L-gang',
      leagueView: LEAGUE_VIEW,
      compareRequested: true,
      whoStartsHim: { leagues: [], locked: true },
      valueTrend: valueTrend(true),
      freeAgentBids: FA_BIDS_LOCKED,
    })
    const locks = [...container.querySelectorAll('.af-core-lock')]
    // The trade visual, compare, who'd start him, the value nudge, the FAAB bids, recommended moves, the verdict column.
    expect(locks.length).toBe(7)
    expect(container.querySelector('.af-pf-tv, .af-pf-tw, .af-core-free-until')).toBeNull()
    for (const l of locks) {
      expect(l.textContent).toMatch(/: parte de AF Pro/)
      expect(l.querySelector('a.af-core-lock-cta')?.getAttribute('href')).toBe('/upgrade?plan=pro')
    }
    const out = ownText(container)
    expectWholeSpanish(out, 'locked')
    for (const subject of ['Intercambiar por Dalton Kincaid', 'Comparación lado a lado', 'Qué equipos pondrían de titular a Kincaid', 'Avisos de comprar barato y vender alto', 'Pujas FAAB sugeridas', 'Movimientos recomendados', 'Veredicto, cambios de banca y ventanas de intercambio']) {
      expect(out, subject).toContain(`${subject}: parte de AF Pro`)
    }
  })

  it('English: the same locked page still reads the lock’s English, byte for byte', () => {
    const container = wholePage({ depthAccess: FREE_READER, compareRequested: true, whoStartsHim: { leagues: [], locked: true }, valueTrend: valueTrend(true), freeAgentBids: FA_BIDS_LOCKED })
    const heads = [...container.querySelectorAll('.af-core-lock-head [data-ios-purchase]')].map((n) => n.textContent)
    expect(heads).toEqual(
      expect.arrayContaining([
        'Side-by-side compare is part of AF Pro',
        'Which teams would start Kincaid is part of AF Pro',
        'Buy-low and sell-high calls are part of AF Pro',
        'Suggested FAAB bids are part of AF Pro',
        'Recommended moves are part of AF Pro',
        'The verdict, bench swaps and trade windows are part of AF Pro',
      ]),
    )
    expect(container.querySelector('.af-core-lock-body [data-ios-purchase]')?.textContent).toBe('Your leagues, scores and the basics stay free. Upgrade to see the rest.')
    expect(container.querySelector('a.af-core-lock-cta')?.textContent).toBe('See AF Pro')
  })
})

/* ── The reasons: every one `reasonText` knows is its loader's sentence, verbatim ────────────────── */

describe('Player Finder — the loaders’ reasons', () => {
  const SOURCES = [
    'lib/core-app/playerFinder.ts',
    'lib/core-app/playerImpact.ts',
    'lib/core-app/playerLeagueView.ts',
    'lib/core-app/snapShare.ts',
  ].map((p) => readFileSync(join(process.cwd(), p), 'utf8'))

  it('each key is written by a loader today, and each reads Spanish', () => {
    expect(FINDER_REASON_KEYS.length).toBeGreaterThan(10)
    for (const key of FINDER_REASON_KEYS) {
      expect(SOURCES.some((s) => s.includes(key)), key).toBe(true)
      expect(reasonText(key, 'es'), key).not.toBe(key)
      expect(reasonText(key, 'en')).toBe(key)
    }
  })

  it('the patterned ones, from the real formatters', () => {
    expect(reasonText(missingColumnsReason('def_snp', 'tm_def_snp'), 'es')).toBe('ningún partido registrado tiene def_snp y tm_def_snp a la vez para este jugador')
    const same = scoringFit({ rec: 1 } as never, 'TE', 1)!
    expect(reasonText(same.reason, 'es')).toBe('las recepciones de TE valen 1 aquí, igual que en la tabla de mercado: sin ajuste')
    const less = scoringFit({ rec: 0.5 } as never, 'WR', 1)!
    expect(reasonText(less.reason, 'es')).toMatch(/^las recepciones de WR valen 0\.5 aquí frente a 1 en la tabla de mercado \(-0\.5 por recepción\), lo que equivale al -?\d+% de los puntos de esta posición$/)
  })

  it('an unknown reason stays whole English', () => {
    expect(reasonText('a reason no loader writes yet', 'es')).toBe('a reason no loader writes yet')
  })
})

/* ── English is unchanged ────────────────────────────────────────────────────────────────────────── */

describe('Player Finder — English is unchanged', () => {
  it('the same screen, in English, byte for byte where a reader keys on it', () => {
    const { container } = renderFinder({ depth: DEPTH })
    expect(container.querySelector('h1')?.textContent).toBe('Player Finder')
    expect(container.querySelector('.af-pf-name-row .af-pf-ready')?.textContent).toBe('Questionable')
    expect(container.querySelector('.af-pf-rostered')?.textContent).toBe(' · on 5 of your 6 leagues, across Yahoo, Sleeper and ESPN · rostered by others in 2')
    expect(container.querySelector('.af-sync')?.textContent).toBe('12m ago')
    expect([...container.querySelectorAll('.af-pf-table th')].map((th) => th.textContent)).toEqual(['League', 'Slot', 'Status', 'Proj', 'AF', 'Value', ''])
    expect([...container.querySelectorAll('.af-pf-slot')].map((s) => s.textContent)).toEqual(['BENCH', 'IR SLOT', 'BENCH', 'BENCH', 'TE', 'NOT YOURS', 'NOT YOURS'])
    expect(container.querySelector('.af-pf-injury-when')?.textContent).toBe('reported Fri 4:00p ET')
    const text = container.textContent ?? ''
    for (const s of [
      'Matches · 1',
      'Proj wk 12',
      'Standard scoring · 2026',
      'AF proj wk 12',
      'of 118 projected TEs',
      'Offensive snaps · 8 games',
      'Every platform, every league',
      'Slot and status as they stand right now',
      'Where to fix it →',
      'Bench is right',
      'No call — unpriced',
      'Trade for Kincaid →',
      'rostered by @tashaR',
      'rostered by another manager',
      'value 6,100',
      'Not checked: Office Pool — its rosters use ESPN player ids we have not matched to our player table yet.',
      'Stats, injuries and news come from live sports data — never an invented number.',
    ]) {
      expect(text, s).toContain(s)
    }
    expect([...container.querySelectorAll('.af-pf-value[title]')].map((v) => v.getAttribute('title'))).toEqual([FIT.reason, 'dynasty · superflex'])
    expect(container.querySelector('.af-pf-value-fit')?.getAttribute('aria-label')).toBe('adjusted for this league’s scoring')
  })
})
