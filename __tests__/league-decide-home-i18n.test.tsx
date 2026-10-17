/**
 * The /league/<id> Decide home in both languages (2026-10-06): DecideHome (KPI row, attention queue,
 * trade cards, support band, footnote), LeagueInfoRail, MatchupCenter, TradeFinder, CommissionerPulse
 * and the ShadowLeagueBanner above them.
 *
 * 🛑 EVERY STRING THESE COMPONENTS WRITE THEMSELVES WAS ENGLISH — found on the live check of the
 * scoring editors, where the league home behind the settings sheet read English under a Spanish
 * account. Text that arrives from an engine or a service is NOT in scope here and is fed neutral
 * tokens below (League Pulse / recommendations from lib/decision-os, the pulse signals and method,
 * the trade-finder rationale and method, the matchup model line): those need their producers to
 * localize, and this test would otherwise blame the components for them.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const h = vi.hoisted(() => ({
  language: 'en' as 'en' | 'es',
  projected: null as unknown,
  recsReady: true,
  finderLinked: true,
  flagged: true,
}))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: h.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: h.language, t }) }
})
vi.mock('@/components/decide/useProjectedStandings', () => ({ isPreseason: () => false, useProjectedStandings: () => h.projected }))
vi.mock('@/components/decide/WaiverIntel', () => ({ WaiverIntel: () => null }))
vi.mock('@/lib/decision-os/league-pulse', () => ({
  buildLeagueHomePulse: () => ({
    id: 'p', title: 'P', eyebrow: '', status: 'healthy', statusLabel: 'OK', headline: 'H', summary: 'S', why: '',
    confidence: 82, confidenceLabel: 'High', evidence: [], derivation: [], metrics: [],
    nextAction: { label: 'L', detail: 'D', href: null }, lastUpdatedIso: '2026-10-06T12:00:00Z',
  }),
}))
vi.mock('@/lib/decision-os/recommendations', () => ({
  buildDecisionRecommendationsViewModel: () => h.recsReady
    ? { title: '', subtitle: '', status: 'ready', confidenceLabel: 'High', evidence: [], lastUpdatedIso: '',
        recommendations: [{ title: 'T', priority: 'high', expectedImpact: 'I', difficulty: 'D2', evidence: [], suggestedAction: 'A', confidence: 'C' }] }
    : { title: '', subtitle: '', status: 'insufficient-data', confidenceLabel: 'Low', evidence: [], lastUpdatedIso: '', recommendations: [] },
}))

import { DecideHome } from '@/components/decide/DecideHome'
import { LeagueInfoRail } from '@/components/decide/LeagueInfoRail'
import { ShadowLeagueBanner } from '@/components/league/ShadowLeagueBanner'

const LEAGUE = { id: 'L1', name: 'Liga X', sport: 'NFL', format: 'dynasty', platform: 'sleeper', teamCount: 12, scoring: 'PPR',
  tradeDeadlineWeek: 10, playoffStartWeek: 15, season: 2026 } as never
const TEAMS = [
  { id: 't1', teamName: 'Mine', ownerName: 'me', wins: 7, losses: 1, ties: 0, pointsFor: 680.4, pointsAgainst: 600, faabRemaining: 80, waiverPriority: 3, currentRank: 2, platformUserId: 'u1' },
  { id: 't2', teamName: 'Other', ownerName: 'o', wins: 8, losses: 0, ties: 0, pointsFor: 700, pointsAgainst: 500, faabRemaining: 50, waiverPriority: 1, currentRank: 1, platformUserId: 'u2' },
] as never

const side = (ownerId: string, unprojected: number) => ({ teamName: ownerId, name: ownerId, ownerId, avatar: null, actualPoints: 0, projectedPoints: 140.5, unprojectedStarters: unprojected })
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    const body =
      u.includes('trades-panel') ? {
        activeTrades: [
          { id: 'x1', direction: 'incoming', partnerName: 'P1', timestamp: '2026-10-01T00:00:00Z', sent: [{ id: 'a', label: 'Pl1', sublabel: 'RB' }], received: [], status: 'pending', viewerIsReceiver: true, viewerIsProposer: false },
          { id: 'x2', direction: 'outgoing', partnerName: 'P2', timestamp: '2026-10-01T00:00:00Z', sent: [], received: [{ id: 'b', label: 'Pl2', sublabel: null }], status: 'awaiting_commissioner', viewerIsReceiver: false, viewerIsProposer: true },
        ],
        verdictContext: { idp: true, idpEmphasis: 'tackle-heavy', scoringFormat: 'ppr', superflex: false, dynasty: true, adpKeyLabel: 'IDP ADP', pirate: { active: false, source: 'detected', lines: [] } },
      }
      : u.includes('manager-intelligence') ? {}
      : u.includes('matchup-center') ? { supported: true, viewerSleeperUserId: 'u1', center: { week: 5, anyPointsScored: false, model: 'MODEL', matchups: [{ matchupId: 'm1', winProbA: 66, a: side('u1', 2), b: side('u2', 0) }] } }
      : u.includes('trade-finder') ? (h.finderLinked
        ? { supported: true, linked: true, finder: {
            proposals: [{ partner: { ownerId: 'u2', name: 'P2', avatar: null, completedTrades: 4 },
              give: { playerId: '1', name: 'G1', position: 'RB', team: 'SEA', adp: 20.5, marketValue: 900 },
              get: { playerId: '2', name: 'G2', position: 'TE', team: 'DAL', adp: 22.1, marketValue: 870 }, valueGapPct: 3.2, adpGap: 1.6, rationale: ['R1'] }],
            viewer: { inLeague: true, openSlots: [], weakSlots: [] }, method: 'METHOD', contextNotes: [], missing: ['X'] } }
        : { supported: true, linked: false, finder: null })
      : u.includes('commissioner-pulse') ? { supported: true, pulse: { flaggedCount: h.flagged ? 1 : 0, method: 'METHOD2', managers: h.flagged
          ? [{ rosterId: 1, ownerId: 'u3', name: 'M3', teamName: null, avatar: null, emptyStarters: 1, daysSinceTx: 30, trend: 'down', signals: ['S1', 'S2'], flagged: true }]
          : [] } }
      : {}
    return { ok: true, status: 200, json: async () => body }
  }))
}

/** The English the components used to write. Word-bounded, case-sensitive, per text node / title / aria-label. */
const FORMER_ENGLISH = [
  'Record', 'No claimed team', 'Standing', 'projected', 'teams', 'Proj. points', 'Points for', 'week', 'season total', 'FAAB left',
  'waiver priority', 'Needs your call', 'reading your league', 'item', 'items', 'every verdict shows its work', 'League pulse', 'updated',
  'Next', 'Recommended move', 'impact', 'Suggested', 'confidence', 'No grounded recommendations', 'Recommendations appear', 'Standings',
  'Your team', 'Team', 'Points against', 'No team records', 'League vitals', 'Format', 'Scoring', 'Teams', 'Trade deadline', 'None set',
  'Week', 'Every number above', 'Trade offer', 'Trade proposal', 'Your call', 'from', 'with', 'You send', 'You receive', 'Nothing',
  'IDP scoring', 'tackle-heavy', 'pirate', 'Review in Trade Center', 'Open Trade Center', 'awaiting commissioner', 'Player value here',
  'Matchup center', 'pre-kickoff', 'live scores', 'proj', 'unprojected', 'your matchup', 'Trade finder', 'suggestion', 'both sides must gain',
  'Offer idea', 'career trades', 'value gap', 'ADP gap', 'you get', 'val', 'Build it in Trade Center', 'Method', "couldn't sync",
  'Commissioner pulse', 'needs a look', 'need a look', 'signals', 'No inactivity flags', 'Every roster', 'Link your Sleeper account',
  'Full standings', 'Vitals', 'Wk', 'None', 'Season', 'Go to', 'Decide', 'Commish', 'product', 'built by', 'Shadow League', 'Imported from',
  'Edit lineups',
]
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[title],[aria-label]')) parts.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const hay = parts.join(' | ')
  return FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}

describe('every key the Decide home names exists in BOTH languages', () => {
  const FILES = ['components/decide/DecideHome.tsx', 'components/decide/LeagueInfoRail.tsx', 'components/decide/MatchupCenter.tsx',
    'components/decide/TradeFinder.tsx', 'components/decide/CommissionerPulse.tsx', 'components/league/ShadowLeagueBanner.tsx']
  const keys = [...new Set(FILES.flatMap((f) => [...readFileSync(resolve(__dirname, '..', f), 'utf8').matchAll(/['"`](decide\.[A-Za-z0-9_.-]+)['"`]/g)].map((m) => m[1]!)))]
  const STATUSES = ['pending', 'awaiting_votes', 'awaiting_commissioner', 'accepted', 'scheduled', 'processed', 'rejected', 'cancelled', 'countered', 'expired', 'vetoed', 'reversed', 'complete']
  const runtime = [...STATUSES.map((s) => `decide.trade.status.${s}`), ...['tackle-heavy', 'big-play', 'balanced'].map((e) => `decide.trade.idp.${e}`)]
  it('🛑 read from the files', () => {
    expect(keys.length).toBeGreaterThanOrEqual(110)
    expect(keys).toEqual(expect.arrayContaining(['decide.foot', 'decide.rail.brandLine1', 'decide.mc.weekPre', 'decide.finder.needsMsg', 'decide.shadow.body']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('the keys built at runtime — trade statuses and IDP emphasis', () => {
    expect(runtime.filter((k) => !translations.en[k] || !translations.es[k])).toEqual([])
    // English stays what `status.replace(/_/g, ' ')` printed.
    for (const s of STATUSES) expect(translations.en[`decide.trade.status.${s}`]).toBe(s.replace(/_/g, ' '))
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect([...keys, ...runtime].filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

describe('🛑 the Decide home shows no card that cannot fill', () => {
  afterEach(() => { h.language = 'en'; h.recsReady = true; vi.unstubAllGlobals(); cleanup() })

  it('no recommendations: no "waiting on behavior signals" card — the queue keeps the pulse and the trades', async () => {
    h.recsReady = false
    stubFetch()
    const r = render(<DecideHome league={LEAGUE} teams={TEAMS} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    await waitFor(() => expect(r.container.textContent).toContain('from P1'))
    const queue = r.container.querySelector('.bdx-queue')!
    expect(queue.textContent).toContain('League pulse')
    expect(queue.textContent).not.toMatch(/No grounded recommendations|Recommendations appear|Behavior signals/)
    expect(queue.querySelector('.bdx-empty')).toBeNull()
  })

  it('…and real recommendations still render when the route returns them', async () => {
    stubFetch()
    const r = render(<DecideHome league={LEAGUE} teams={TEAMS} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    await waitFor(() => expect(r.container.textContent).toContain('Recommended move'))
  })
})

describe('points against: 0 is "not known", not a score', () => {
  afterEach(() => { vi.unstubAllGlobals(); cleanup() })
  const ZERO_PA = [{ ...(TEAMS as unknown as Array<Record<string, unknown>>)[0], pointsAgainst: 0 }, (TEAMS as unknown as unknown[])[1]] as never

  it('the helper', async () => {
    const { pointsAgainstText } = await import('@/components/decide/pointsAgainst')
    expect(pointsAgainstText(600)).toBe('600.0')
    expect(pointsAgainstText(0)).toBe('—')
    expect(pointsAgainstText(null)).toBe('—')
    expect(pointsAgainstText(undefined)).toBe('—')
  })

  it('🛑 the Your team panel and the rail print — for a 0, the number otherwise (measured live: "736.5 / 0.0")', async () => {
    stubFetch()
    let r = render(<DecideHome league={LEAGUE} teams={ZERO_PA} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    const row = [...r.container.querySelectorAll('.bdx-row')].find((x) => x.textContent?.startsWith('Points against'))!
    expect(row.textContent).toBe('Points against—')
    cleanup()
    r = render(<LeagueInfoRail league={LEAGUE} teams={ZERO_PA} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    expect(r.container.textContent).toContain('680.4 / —')
    cleanup()
    r = render(<LeagueInfoRail league={LEAGUE} teams={TEAMS} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    expect(r.container.textContent).toContain('680.4 / 600.0')
  })
})

describe('🛑 the Decide home reads Spanish in Spanish', () => {
  afterEach(() => {
    h.language = 'en'; h.projected = null; h.recsReady = true; h.finderLinked = true; h.flagged = true
    vi.unstubAllGlobals(); cleanup()
  })

  it('a commissioner with trades, a recommendation, matchups, a trade idea and a flagged manager', async () => {
    h.language = 'es'
    stubFetch()
    const r = render(<DecideHome league={LEAGUE} teams={TEAMS} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    await waitFor(() => expect(r.container.textContent).toContain('Idea de oferta · para'))
    await r.findByText('Centro de enfrentamientos')
    await r.findByText('Pulso del comisionado')
    await waitFor(() => expect(r.container.textContent).toContain('Requiere tu decisión'))
    const text = r.container.textContent ?? ''
    for (const s of ['Récord', 'Posición', '2.º', 'de 2 equipos', 'Puntos a favor', 'total de la temporada', 'FAAB restante', 'prioridad de reclamo 3',
      'cada veredicto muestra su razonamiento', 'Pulso de la liga', 'actualizado', 'Siguiente: L — D', 'Movimiento recomendado', 'impacto: I · D2',
      'Sugerido: A · confianza C', 'Oferta de trade', 'Tu decisión', 'de P1', 'Propuesta de trade', 'esperando al comisionado', 'con P2', 'Envías',
      'Recibes', 'Nada', '◆ puntuación IDP · muchas tacleadas', '☠ ¿pirata? sin confirmar', 'Revisar en el Trade Center', 'Abrir el Trade Center',
      'Clasificación', 'Tu equipo', 'Puntos en contra', 'Datos de la liga', 'Formato', 'Fecha límite de trades', 'Semana 10', 'Semana 15',
      'Cada número de esta página', 'semana 5 · antes del inicio', 'proy. 140.5', '(2 sin proyección)', 'tu enfrentamiento',
      '1 sugerencia · ambos lados deben ganar', '↔ 4 trades en su carrera', 'diferencia de valor 3.2%', '· valor 900', '⇄ recibes',
      'Ármalo en el Trade Center', 'Método:', 'no se pudo sincronizar: X', '1 mánager necesita una revisión', '⚠ 2 señales']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('[title="El valor de los jugadores aquí se lee con IDP ADP y la puntuación real (IDP) de tu liga."]')).not.toBeNull()
    expect(englishIn(r.container)).toEqual([])
  })

  it('the empty states — no recommendations, an unlinked finder, no flagged managers', async () => {
    h.language = 'es'
    h.recsReady = false; h.finderLinked = false; h.flagged = false
    stubFetch()
    const r = render(<DecideHome league={LEAGUE} teams={TEAMS} userTeamId={null} isCommissioner onOpenTab={() => {}} />)
    await r.findByText('Vincula tu cuenta de Sleeper para recibir sugerencias de trades')
    await r.findByText('Sin alertas de inactividad esta semana')
    await waitFor(() => expect(r.container.textContent).toContain('Pulso de la liga'))
    const text = r.container.textContent ?? ''
    // No recommendations → no card at all (the route has returned none since 2026-09-10; see DecideHome).
    expect(text).not.toContain('Aún no hay recomendaciones fundamentadas')
    expect(text).not.toContain('Las recomendaciones aparecen cuando')
    for (const s of ['Sin equipo reclamado', 'Aún no tienes un equipo reclamado en esta liga.',
      'todas las plantillas se ven activas', 'Todas las plantillas tienen la alineación completa']) {
      expect(text, s).toContain(s)
    }
    expect(englishIn(r.container)).toEqual([])
  })

  it('the left rail — projected standings, vitals, quick links and the brand line', () => {
    h.language = 'es'
    h.projected = { week: 1, scoringMode: 'league-scored', rows: [{ rosterId: 1, ownerId: 'u1', teamName: 'Mine', name: 'me', projectedPoints: 150 }] }
    const r = render(<LeagueInfoRail league={LEAGUE} teams={TEAMS} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    const text = r.container.textContent ?? ''
    for (const s of ['12 equipos', 'Comisionado', 'Tu equipo', 'PF / PC', 'Clasificación · proyectada sem 1',
      'Puntos proyectados de los titulares de la semana 1 · la puntuación de tu liga. Los resultados reales mandan',
      'Clasificación completa', 'Datos', 'Sem 10', 'Sem 15', 'Temporada', 'Ir a', 'Decidir', 'Un producto de AllFantasy', 'creado por Brown Pig LLC']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('b')?.textContent).toBe('AllFantasy')
    expect(englishIn(r.container)).toEqual([])
  })

  it('the Shadow League banner', () => {
    h.language = 'es'
    const r = render(<ShadowLeagueBanner platform="sleeper" />)
    expect(r.container.textContent).toContain('Liga sombra')
    expect(r.container.textContent).toMatch(/Importada de (\S+)\. Edita alineaciones.*nunca llegan a \1, que sigue siendo/)
    expect(englishIn(r.container)).toEqual([])
  })

  it('…and all of it still reads English in English', async () => {
    stubFetch()
    const r = render(<DecideHome league={LEAGUE} teams={TEAMS} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    await waitFor(() => expect(r.container.textContent).toContain('Offer idea · to'))
    await r.findByText('Matchup center')
    await waitFor(() => expect(r.container.textContent).toContain('Needs your call'))
    for (const s of ['2nd', 'of 2 teams', 'waiver priority 3', '2 items · every verdict shows its work', 'Trade offer', 'from P1', 'awaiting commissioner',
      'week 5 · pre-kickoff', 'proj 140.5', ' (2 unprojected)', '1 suggestion · both sides must gain', ' · val 900', "couldn't sync: X",
      '1 manager needs a look', '⚠ 2 signals', 'Week 10']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(r.container.textContent).not.toMatch(/\bdecide\./)
    cleanup()
    h.projected = { week: 1, scoringMode: 'format-based', rows: [{ rosterId: 1, ownerId: 'u1', teamName: 'Mine', name: 'me', projectedPoints: 150 }] }
    const rail = render(<LeagueInfoRail league={LEAGUE} teams={TEAMS} userTeamId="t1" isCommissioner onOpenTab={() => {}} />)
    expect(rail.container.textContent).toContain('Projected week-1 starter points · format-based projections. Real results take over after kickoff.')
    expect(rail.container.textContent).toContain('An AllFantasy productbuilt by Brown Pig LLC')
    cleanup()
    const b = render(<ShadowLeagueBanner platform="sleeper" />)
    expect(b.container.textContent).toMatch(/Shadow LeagueImported from (\S+)\. Edit lineups, trades and waivers freely — changes stay inside AllFantasy and never reach \1, which remains your league's system of record\./)
  })
})
