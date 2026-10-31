/**
 * Spanish gaps on four surfaces (2026-10-31): the draft room top bar and its overflow menu, the
 * Round 1 pick announcement, the dynasty home tab with its War Room panel, and the native league
 * workspace shell. Each surface is rendered twice from the real dictionaries: in Spanish, where the
 * strings this pass translated must be gone, and in English, where every one of them must still read
 * exactly as it did before.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  const { tInterpolate } = await import('@/lib/i18n/tInterpolate')
  const value = () => {
    const dict = translations[lang.language]
    const t = (key: string) => dict[key] ?? translations.en[key] ?? key
    return { language: lang.language, setLanguage: () => {}, t, tInterpolate: (key: string, vars = {}) => tInterpolate(t, key, vars) }
  }
  return { useLanguage: value, useOptionalLanguage: value }
})

const war = vi.hoisted(() => ({ context: null as unknown }))
vi.mock('@/lib/dynasty-war-room/client', () => ({
  fetchDynastyWarRoomState: vi.fn(async () => ({
    context: war.context,
    direction: { window: 'rebuild', contendScore: 31, avgStarterAge: 27.4, youngValueShare: 0.42 },
    needs: { urgencyScore: 55, needs: [{ position: 'WR', severity: 'high' }], strengths: [], tradeTargetPositions: [] },
  })),
  fetchDynastyWarRoomBuySellHold: vi.fn(async () => ({
    buySellHold: { window: 'rebuild', pickCapitalNote: null, missingDataFlags: [], entries: [{ playerId: 'p1', playerName: 'Old Back', position: 'RB', age: 29, call: 'sell', reason: 'r' }] },
  })),
  findDynastyWarRoomTrades: vi.fn(async () => ({ tradeFinder: { needsMoreData: false, missingDataFlags: [], targets: [] } })),
  fetchDynastyWarRoomWaivers: vi.fn(async () => ({
    waivers: { needsProviderIntegration: false, recommendedAdds: [], recommendedDrops: [], unrankedProspects: [], prospectList: null, missingDataFlags: [] },
  })),
  analyzeDynastyWarRoomTrade: vi.fn(),
  askDynastyWarRoom: vi.fn(),
  fetchDynastyWarRoomLineup: vi.fn(),
}))

import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { DraftRoundOneAnnouncementOverlay } from '@/components/app/draft-room/DraftRoundOneAnnouncementOverlay'
import { DynastyHome } from '@/app/league/[leagueId]/tabs/DynastyHome'
import { DynastyWarRoomPanel } from '@/app/league/[leagueId]/tabs/dynasty/DynastyWarRoomPanel'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { roundOneHypeLine } from '@/lib/draft-room/roundOneHypeLine'
import { translations } from '@/lib/i18n/translations'

/** Everything a reader can see or hear: text plus title / aria-label / placeholder attributes. */
function readable(root: ParentNode = document.body): string {
  const attrs = [...root.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((el) =>
    ['title', 'aria-label', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  )
  return [root.textContent ?? '', ...attrs].join('\n')
}
function expectAll(text: string, needles: string[]) {
  const missing = needles.filter((n) => !text.includes(n))
  expect(missing, `missing: ${missing.join(' | ')}`).toEqual([])
}
function expectNone(text: string, needles: string[]) {
  const left = needles.filter((n) => text.includes(n))
  expect(left, `still English: ${left.join(' | ')}`).toEqual([])
}

beforeEach(() => {
  lang.language = 'en'
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
})
afterEach(() => {
  vi.unstubAllGlobals()
  lang.language = 'en'
})

describe('i18n keys for this pass', () => {
  it('every key exists in English and Spanish, and the Spanish never says waiver', () => {
    const prefixes = ['draftRoom.topBarMenu.', 'draftRoom.topBarHint.', 'draftRoom.roundOne.', 'dynastyHome.', 'dynastyWarRoom.panel.', 'nativeLeague.']
    const keys = Object.keys(translations.en).filter((k) => prefixes.some((p) => k.startsWith(p)))
    expect(keys.length).toBeGreaterThan(200)
    const missing = keys.filter((k) => !(k in translations.es))
    expect(missing).toEqual([])
    const waiver = keys.filter((k) => /waiver/i.test(translations.es[k]!))
    expect(waiver).toEqual([])
  })
})

// ───────────────────────── Draft room top bar ─────────────────────────

const topBarBase = {
  leagueName: 'Dynasty Den', sport: 'NFL', draftType: 'snake', teamCount: 12, rounds: 4,
  currentManagerOnClock: 'Orphan Team', pickLabel: '1.03', overallPickNumber: 3,
  timerStatus: 'paused' as const, timerRemainingSeconds: 42, isCommissioner: true, draftStatus: 'paused',
  onPause: () => {}, onResume: () => {}, onToggleAutoPick: () => {}, onStartDraft: () => {},
  onCommissionerOpen: () => {}, onResetTimer: () => {}, onUndoPick: () => {}, onRunAiPick: () => {},
  onTradesClick: () => {}, pendingTradesCount: 2, onResync: () => {}, onOpenDraftRoomSettings: () => {},
  bigScreenHref: '/big', onlineCount: 3, isOrphanOnClock: true, isReconnecting: true,
  showUseQueue: true, onUseQueue: () => {},
  aiRecommendationOverlay: { label: 'Pick', playerName: 'Ace', valueDelta: 2.5, stackAvailable: true, byeWeekConflict: true },
}
function renderTopBar() {
  const utils = render(<DraftTopBar {...topBarBase} />)
  fireEvent.click(screen.getByTestId('draft-topbar-menu-toggle'))
  return utils
}

const TOP_BAR_EN = [
  '3 managers online', 'Value +2.5', 'Stack', 'Bye conflict', 'Click to resume the draft. Time remaining is restored from when it was paused.',
  'Resume draft', 'Resume the draft', 'Toggle autopick: when enabled, will auto-pick when timer expires', 'Auto-pick ', 'Auto ',
  'Mute timer beeps (10s / 5s / final)', 'Draft options', 'Copy Invite Link', 'Your friends can join via this link',
  'Big Screen Mode', 'Read-only board view for casting to a TV.', 'Set Draft Order', 'Set or edit the draft order',
  '2 pending trades', 'Refresh timer, queue, and board state', 'Draft Room Preferences', 'Room timer, automation, and presentation',
  'Commissioner control center', 'Commissioner Control Center', 'Start, pause, resume, picks, and automation',
  'Resume Draft', 'Restart the draft timer', 'Run AI Pick', 'Trigger the orphan team drafter for the current pick',
  'Reset Timer', 'Undo Pick', 'Sync issue', 'Draft session poll failed several times in a row. The room keeps your last good snapshot; polls retry automatically.',
]

describe('draft room top bar', () => {
  it('English: every translated string reads exactly as before', () => {
    renderTopBar()
    expectAll(readable(), TOP_BAR_EN)
    expect(screen.getByTestId('draft-topbar-autopick-pill').textContent).toBe('Auto-pick Auto Off')
  })

  it('Spanish: the hints, tooltips and the whole overflow menu are translated', () => {
    lang.language = 'es'
    renderTopBar()
    const text = readable()
    expectNone(text, TOP_BAR_EN.filter((s) => !['Auto-pick ', 'Auto '].includes(s)))
    expectAll(text, [
      '3 mánagers en línea', 'Copiar enlace de invitación', 'Modo pantalla grande', 'Fijar orden del draft',
      '2 intercambios pendientes', 'Centro de control del comisionado', 'Reanudar draft', 'Reiniciar temporizador',
      'Deshacer pick', 'Desincronizado', 'Opciones del draft', 'Choque de descanso', 'Valor +2.5',
    ])
    expect(screen.getByTestId('draft-topbar-autopick-pill').textContent).toBe('Auto-pick Auto No')
  })

  it('Spanish: the running-clock and on-the-clock states are translated too', () => {
    lang.language = 'es'
    render(<DraftTopBar {...topBarBase} isCommissioner={false} isOrphanOnClock={false} isCurrentUserOnClock draftStatus="in_progress" timerStatus="running" pendingTradesCount={1} />)
    const text = readable()
    expectAll(text, ['Te toca elegir', 'Temporizador del pick en curso.'])
    expectNone(text, ["You're on the clock", 'On-the-clock pick timer.'])
  })
})

// ───────────────────────── Round 1 announcement ─────────────────────────

const pick = {
  id: 'p1', overall: 3, round: 1, slot: 3, rosterId: 'r1', displayName: null, playerName: 'Bo Nix', position: 'QB',
  team: 'DEN', byeWeek: 12, playerId: 'x', tradedPickMeta: null, source: 'user', pickLabel: '1.03', createdAt: '2026-01-01',
}
const queue = [1, 2, 3].map((n) => ({ id: `q${n}`, pick, headshotUrl: null, teamLogoUrl: null })) as never
const OVERLAY_EN = [
  'Round 1 selection', 'Skip', 'Pick 1.03', 'Overall #3', 'Bye 12', 'Draft board', 'NFL · Round 1 · Pick 3 · #3 overall',
  'Commanding the board early with a field general.', '+2 more Round 1 picks queued',
  'Round one pick announcement', 'Skip announcement', 'Dismiss announcement',
]

describe('Round 1 pick announcement', () => {
  it('English: identical copy, including the hype line and the queue count', () => {
    render(<DraftRoundOneAnnouncementOverlay sportLabel="NFL" queue={queue} onDismissFront={() => {}} />)
    expectAll(readable(), OVERLAY_EN)
  })

  it('Spanish: no English left in the card', () => {
    lang.language = 'es'
    render(<DraftRoundOneAnnouncementOverlay sportLabel="NFL" queue={queue} onDismissFront={() => {}} />)
    const text = readable()
    expectNone(text, OVERLAY_EN.filter((s) => s !== 'Pick 1.03'))
    expectAll(text, ['Selección de la ronda 1', 'Saltar', 'General n.º 3', 'Descanso 12', 'Tablero del draft', '+2 picks más de la ronda 1 en espera'])
  })

  it('the hype line keeps its English without a translator, and translates with one', () => {
    expect(roundOneHypeLine({ sport: 'NFL', position: 'QB', formatType: 'survivor' })).toBe(
      'Commanding the board early with a field general. The first torch on the island is lit.',
    )
    const es = (k: string) => translations.es[k] ?? k
    expect(roundOneHypeLine({ sport: 'NHL', position: 'G', formatType: 'survivor' }, es)).toBe(
      'Un portero titular antes de que nadie parpadee. La primera antorcha de la isla ya está encendida.',
    )
    // A missing key falls back to English rather than printing the key.
    expect(roundOneHypeLine({ sport: 'NBA', position: 'C' }, (k) => k)).toBe('Anchoring the paint from pick one.')
  })
})

// ───────────────────────── Dynasty home ─────────────────────────

function stubDynastyFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = url.includes('dynasty-hub')
      ? {
          taxi: [{ id: 't1', name: 'Rook One', position: 'WR', eligibilityYearsLeft: 1 }, { id: 't2', name: 'Rook Two', position: 'RB', eligibilityYearsLeft: 2 }],
          picks: [
            { id: 'k1', year: 2027, round: 1, fromTeam: 'Bravo', type: 'incoming' },
            { id: 'k2', year: 2027, round: 2, fromTeam: null, type: 'traded_away' },
            { id: 'k3', year: 2028, round: 1, fromTeam: null, type: 'own' },
          ],
        }
      : url.includes('standings')
        ? { standings: [{ rank: 1, teamName: 'Alpha', wins: 3, losses: 1, ties: 0, pointsFor: 400.5, draftPosition: null }] }
        : { matchups: [{ week: 1, home: 'Alpha', away: 'Bravo', homeScore: null, awayScore: null }] }
    return { ok: true, json: async () => json }
  }))
}
async function walkDynastyHome() {
  render(<DynastyHome leagueId="L1" />)
  const seen: string[] = []
  await waitFor(() => expect(screen.getByRole('button', { pressed: true })).toBeTruthy())
  await waitFor(() => expect(document.body.textContent).not.toMatch(/Loading dynasty data|Cargando datos/))
  seen.push(readable())
  const buttons = () => [...document.querySelectorAll('button[aria-pressed]')] as HTMLElement[]
  for (let i = 1; i < buttons().length; i += 1) {
    if (i === 3) continue // All Teams' Picks mounts LeaguePickBoard, which has its own fetches and copy.
    await act(async () => { fireEvent.click(buttons()[i]!) })
    await waitFor(() => expect(document.body.textContent).not.toMatch(/Loading schedule|Cargando calendario/))
    seen.push(readable())
  }
  return seen.join('\n')
}
const DYNASTY_HOME_EN = [
  'Overview', '🚕 Taxi Squad', '📋 Draft Picks', '🗂 All Teams’ Picks', '📊 Standings', '📅 Schedule', 'Future Picks', 'Teams',
  'Dynasty league hub — manage your taxi squad, trade future picks, and track standings across the dynasty.',
  '1 yr left', '2 yrs left', '2027 Round 1', 'From Bravo', 'To another team', 'Own pick', 'Incoming', 'Traded away',
  'Team', 'PF', 'Week 1',
]

describe('dynasty home', () => {
  it('English: every label, caption and the hub sentence read as before', async () => {
    stubDynastyFetch()
    expectAll(await walkDynastyHome(), DYNASTY_HOME_EN)
  })

  it('Spanish: tabs, stat captions, hub sentence and every sub-view are translated', async () => {
    lang.language = 'es'
    stubDynastyFetch()
    const text = await walkDynastyHome()
    expectNone(text, ['Overview', 'Taxi Squad', 'Draft Picks', 'All Teams’ Picks', 'Standings', 'Schedule', 'Future Picks',
      'Dynasty league hub', 'yr left', 'yrs left', 'Round 1', 'From Bravo', 'another team', 'Own pick', 'Incoming', 'Traded away', 'Week 1'])
    expectAll(text, ['Resumen', '🚕 Plantel taxi', 'Picks futuros', 'Queda 1 año', 'Quedan 2 años', '2027 Ronda 1', 'De Bravo',
      'Para otro equipo', 'Pick propio', 'Recibido', 'Traspasado', 'Equipo', 'Semana 1'])
  })
})

// ───────────────────────── Dynasty War Room panel ─────────────────────────

function warContext() {
  return {
    leagueId: 'L1', leagueType: 'dynasty', sport: 'NFL', season: 2026,
    scoring: { sport: 'NFL', scoringPreset: 'ppr', superflex: false, tePremium: false },
    roster: { totalStarterSlots: 0, benchSlots: 0, taxiSlots: 0, irSlots: 0, requiredByPosition: {} },
    userRosterId: 'r1', isCommissioner: false,
    teams: [{
      rosterId: 'r1', ownerId: 'u', ownerName: 'Alpha', teamName: 'Alpha', wins: 0, losses: 0, ties: 0, pointsFor: 0, playoffSeed: null, isUserTeam: true,
      players: [{ playerId: 'p9', playerName: 'Taxi Kid', position: 'WR', slotType: 'taxi', age: 21, isStarterSlot: false }],
      picks: [{ id: 'fdp', season: 2027, round: 1, originalRosterId: 'r2', originalTeamName: 'Bravo', currentOwnerId: 'r1', traded: true, status: 'active', estValue: 8.5 }],
    }],
    freeAgents: [], rookieDraftWindows: [],
    availability: { playerValues: 'available', playerAges: 'missing', futurePicks: 'partial' },
    missingDataFlags: [],
  }
}
const WAR_EN = [
  'AF Legacy — Dynasty', 'Direction', 'Rebuilding', 'Age / value', 'avg starter age 27.4', ' · young 42%', 'Data',
  '0 FAs · val ✓ · age — · picks partial', 'Roster needs · urgency 55/100', 'NEEDS', 'STRENGTHS', 'TARGET POSITIONS',
  'Taxi watch', 'Pick capital', 'Acquired from Bravo', ' · tier 8.5',
  "Only picks that changed hands are listed — this league's rookie-draft size isn't known, so your own picks aren't shown.",
  'Tiers are structural (round + years out), not market values.', 'Buy / Sell / Hold', 'Waivers', 'Lineup', 'Trade analyzer',
  'Trade finder', 'Ask AF Legacy', "e.g. Should I sell my aging RB while I'm rebuilding?",
  'Asset calls — window: Rebuilding', 'SELL',
]
async function walkWarRoom() {
  war.context = warContext()
  render(<DynastyWarRoomPanel leagueId="L1" />)
  await screen.findByTestId('dynasty-war-room-panel')
  const first = readable()
  await act(async () => { fireEvent.click(screen.getByTestId('dynasty-war-room-tool-buy-sell-hold')) })
  await screen.findByTestId('dynasty-war-room-buy-sell-hold-result')
  const second = readable()
  await act(async () => { fireEvent.click(screen.getByTestId('dynasty-war-room-tool-trade-find')) })
  await screen.findByTestId('dynasty-war-room-trade-find-result')
  return [first, second, readable()].join('\n')
}

describe('dynasty War Room panel', () => {
  it('English: the visible copy is unchanged', async () => {
    const text = await walkWarRoom()
    expectAll(text, [...WAR_EN, 'No complementary trade partners found right now.'])
  })

  it('Spanish: the visible copy is translated, and the waiver tool is not called waiver', async () => {
    lang.language = 'es'
    const text = await walkWarRoom()
    expectNone(text, WAR_EN.filter((s) => !['AF Legacy — Dynasty'].includes(s)).concat(['No complementary trade partners']))
    expectAll(text, ['AF Legacy — Dinastía', 'Rumbo', 'En reconstrucción', 'edad media de titulares 27.4', '0 agentes libres · valor ✓ · edad — · picks parcial',
      'NECESIDADES', 'Capital de picks', 'Adquirido de Bravo', 'Agentes libres', 'Decisiones por activo — momento: En reconstrucción', 'VENDER',
      'Ahora mismo no hay socios de intercambio complementarios.'])
    expect(text).not.toMatch(/waiver/i)
  })
})

// ───────────────────────── Native league workspace ─────────────────────────

const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'roster', label: 'My team' }, { id: 'matchups', label: 'Matchup' },
  { id: 'waivers', label: 'Players' }, { id: 'league_chat', label: 'Chat' },
]
const wsLeague = (over: Record<string, unknown> = {}) => ({
  id: 'lg1', name: 'Dynasty Den', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 12, format: 'Dynasty',
  scoring: 'PPR', currentWeek: 5, lifecycleState: 'in_season', leagueVariant: 'dynasty', ...over,
}) as never
function renderWorkspace(league = wsLeague(), activeTab = 'native_home') {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  const other = wsLeague({ id: 'lg2', name: 'Other League' })
  return render(
    <NativeLeagueWorkspace native league={league} leagues={[league, other]} tabs={TABS} activeTab={activeTab}
      isCommissioner onSelectTab={() => {}} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}>
      <div>tab</div>
    </NativeLeagueWorkspace>,
  )
}
const WS_EN = [
  'All leagues', 'Your settings', 'Viewing', 'Jump to a league', 'Hosted on AF · Beta', 'NFL · Wk 5', 'Native on AllFantasy',
  'Commissioner', '12 teams', 'League settings', 'Setup', 'Regular season', 'Offseason', 'Section', 'League section',
  'Current section', 'League sections', 'Mobile league navigation', 'Your leagues', 'Close league switcher', 'Search your leagues',
  'League filters', 'All 2', 'On AF', 'Synced', 'Create league', 'Import league', 'Create a league', '2 leagues',
  'Collapse the league rail', 'League navigation', 'Open league navigation', 'Previous league: Other League', 'Dynasty Den, switch league',
  'League progress', 'Switch league', 'AllFantasy dashboard',
]

describe('native league workspace', () => {
  it('English: shell labels, phase strip and bottom bar are unchanged', () => {
    const { container } = renderWorkspace(wsLeague(), 'somewhere_else')
    expectAll(readable(), WS_EN)
    const bottom = [...container.querySelector('.nl-bottom-nav')!.children].map((el) => el.textContent)
    expect(bottom).toEqual(['League', 'Matchup', 'Team', 'Players', 'Chat'])
    expect(container.querySelector('.nl-eyebrow')!.textContent).toBe('Regular season')
  })

  it('Spanish: the same labels are translated, and phase values still drive the strip', () => {
    lang.language = 'es'
    const { container } = renderWorkspace(wsLeague(), 'somewhere_else')
    const text = readable()
    expectNone(text, ['All leagues', 'Your settings', 'Jump to a league', 'Hosted on AF', 'Native on AllFantasy', '12 teams',
      'League settings', 'Regular season', 'Offseason', 'Current section', 'League sections', 'Search your leagues', 'All 2',
      'Synced', 'Create league', 'Import league', 'Create a league', '2 leagues', 'Previous league', 'switch league'])
    // The rail rows carry their own week label (LeagueRail), so the top bar's week is read where it renders.
    expect(container.querySelector('.nl-sport-week')!.textContent).toBe('NFL · Sem. 5')
    expectAll(text, ['Todas las ligas', 'Viendo', 'Ir a una liga', 'Nativa de AllFantasy', '12 equipos', 'Temporada regular',
      'Fuera de temporada', 'Sección actual', 'Tus ligas', 'Todas 2', 'Sincronizadas', 'Importar liga', '2 ligas'])
    const bottom = [...container.querySelector('.nl-bottom-nav')!.children].map((el) => el.textContent)
    expect(bottom).toEqual(['Liga', 'Duelo', 'Equipo', 'Jugadores', 'Chat'])
    // The phase is still matched on its English value; only the label changed.
    expect(container.querySelector('.nl-phase [aria-current="step"]')!.textContent).toBe('Temporada regular')
  })

  it('Spanish: a redraft league keeps its season on the chip', () => {
    lang.language = 'es'
    const { container } = renderWorkspace(wsLeague({ name: 'Sunday League', leagueVariant: 'redraft', leagueType: 'redraft', format: 'redraft' }))
    expect(container.querySelector('[data-testid=redraft-season-chip]')!.textContent).toBe('Redraft · 2026')
  })
})
