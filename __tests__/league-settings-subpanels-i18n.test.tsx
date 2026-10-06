/**
 * The league settings modal's panels, in both languages (2026-10-05) — part 2 of the frame.
 *
 * 🛑 EVERY PANEL BEHIND A SETTINGS CARD WAS ENGLISH-ONLY: the league snapshot, roster spots and
 * limits (incl. the position names), playoffs, drafts and the draft history cards, notifications,
 * invite, co-owners, the history chain, commissioner general / note / tools / danger zone, the
 * local dues toggle, the AI tool panels, My Team — plus the rules summary and full scoring section
 * the commissioner hub shows, and the Discord card. #2050 translated the frame around them.
 *
 * The guard reads every `lsPanel.` / `lsModal.` key the four files (and the waiver helper) name,
 * plus the slot keys built at runtime, and requires each in both dictionaries. The renders mount
 * the real panels with only unrelated heavy children mocked, and scan each TEXT NODE (plus
 * placeholders, titles and aria-labels) for the English the panels used to print.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
/* The provider's own resolution: the language's dictionary, then English, then the key itself. */
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/league/l1', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/hooks/useAfSubGate', () => ({ useAfSubGate: () => ({ handleApiResponse: async () => true }) }))
const stub = vi.hoisted(() => (name: string) => ({ [name]: () => null }))
vi.mock('@/components/league-settings/PlayoffSettingsEditor', () => stub('PlayoffSettingsEditor'))
vi.mock('@/components/league-settings/RosterSettingsEditor', () => stub('RosterSettingsEditor'))
vi.mock('@/components/league-settings/NflScoringSettingsPanel', () => stub('NflScoringSettingsPanel'))
vi.mock('@/components/league-settings/NbaScoringSettingsPanel', () => stub('NbaScoringSettingsPanel'))
vi.mock('@/components/league-settings/NcaabScoringSettingsPanel', () => stub('NcaabScoringSettingsPanel'))
vi.mock('@/components/league-settings/MlbScoringSettingsPanel', () => stub('MlbScoringSettingsPanel'))
vi.mock('@/components/league-settings/NhlScoringSettingsPanel', () => stub('NhlScoringSettingsPanel'))
vi.mock('@/components/league-settings/NcaafScoringSettingsPanel', () => stub('NcaafScoringSettingsPanel'))
vi.mock('@/components/league-settings/SoccerScoringSettingsPanel', () => stub('SoccerScoringSettingsPanel'))
vi.mock('@/components/league-settings/DraftSettingsCommissionerPanel', () => stub('DraftSettingsCommissionerPanel'))
vi.mock('@/components/league-settings/DivisionSettingsCommissionerPanel', () => stub('DivisionSettingsCommissionerPanel'))
vi.mock('@/components/league-settings/MemberSettingsCommissionerPanel', () => stub('MemberSettingsCommissionerPanel'))
vi.mock('@/app/idp/components/settings/IDPRosterPanel', () => stub('IDPRosterPanel'))
vi.mock('@/app/idp/components/settings/IDPScoringPanel', () => stub('IDPScoringPanel'))
vi.mock('@/app/idp/components/settings/IDPDisplayPanel', () => stub('IDPDisplayPanel'))
vi.mock('@/app/idp/components/settings/IDPAIPanel', () => stub('IDPAIPanel'))
vi.mock('@/app/league/[leagueId]/components/DeleteLeagueFromAfPanel', () => stub('DeleteLeagueFromAfPanel'))
vi.mock('@/components/monetization/PlanRefusalNotice', () => stub('PlanRefusalNotice'))

import { SettingsSubPanelBody } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import { LeagueRulesSummarySection } from '@/app/league/[leagueId]/components/LeagueRulesSummarySection'
import { ScoringSettingsFullSection } from '@/app/league/[leagueId]/components/ScoringSettingsFullSection'

const DIR = resolve(__dirname, '../app/league/[leagueId]/components')
const FILES = ['LeagueSettingsSubPanels.tsx', 'LeagueRulesSummarySection.tsx', 'ScoringSettingsFullSection.tsx', 'DiscordLeagueSyncPanel.tsx', 'league-settings-modal-utils.ts']
const SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'REC_FLEX', 'WRRB_FLEX', 'WRT_FLEX', 'SUPER_FLEX', 'K', 'DEF', 'DL', 'LB', 'DB', 'IDP_FLEX', 'BN']

describe('every key the panels name exists in BOTH languages', () => {
  const keys = [...new Set(FILES.flatMap((f) => [...readFileSync(resolve(DIR, f), 'utf8').matchAll(/['"`]((?:lsPanel|lsModal)\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]!)))]
  it('🛑 read from the files — the scan sees the real keys', () => {
    expect(keys.length).toBeGreaterThanOrEqual(220) // measured: 247 literal keys
    expect(keys).toEqual(expect.arrayContaining(['lsPanel.tools.intro', 'lsPanel.rules.syncNote', 'lsPanel.discord.missingAfter', 'lsPanel.waiver.faab']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('the slot names built at runtime (`lsPanel.slot.${slot}`) — no literal scan can see them', () => {
    const src = readFileSync(resolve(DIR, 'LeagueSettingsSubPanels.tsx'), 'utf8')
    for (const s of SLOTS) expect(src, s).toContain(`'${s}'`) // the set the code builds from
    expect(SLOTS.filter((s) => !translations.en[`lsPanel.slot.${s}`] || !translations.es[`lsPanel.slot.${s}`])).toEqual([])
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

const SETTINGS = {
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'TE', 'FLEX', 'DL', 'BN'], reserve_slots: 2, taxi_slots: 3,
  playoff_teams: 6, playoff_week_start: 15, playoff_round_type: 1, playoff_seed_type: 1, toilet_bowl: 1, consolation_bracket_enabled: true,
  waiver_type: 1, waiver_budget: 100, trade_deadline: 11, total_rosters: 12, sport: 'nfl', season: '2026', divisions: 2, draft_id: 'd1',
  scoring_settings: { rec: 1, pass_td: 4, rush_yd: 0.1 }, status: 'in_season',
}
function ctx(over: Record<string, unknown> = {}) {
  return {
    league: {
      id: 'l1', platform: 'sleeper', userId: 'u1', sport: 'NFL', settings: SETTINGS, invites: [],
      teams: [
        { id: 't1', teamName: 'Aces', ownerName: 'Pat', platformUserId: null, claimedByUserId: 'u1', avatarUrl: null },
        { id: 't2', teamName: 'Bees', ownerName: 'Lee', platformUserId: null, claimedByUserId: null, avatarUrl: null },
      ],
    },
    displayLeague: { id: 'l1', name: 'Test League', teamCount: 12, sport: 'NFL', season: 2026, currentWeek: 1, draftDate: null },
    userId: 'u1', userTeam: { teamName: 'Aces', ownerName: 'Pat', avatarUrl: null }, sleeperLeagueId: 's1', platformLeagueId: 'p1',
    isCommissioner: true, isHeadCommissioner: true, sleeperMemberMap: {}, onGoToDraftTab: () => {},
    ...over,
  } as never
}
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    const body = u.includes('sleeper-hosted-draft-history')
      ? { rows: [
          { season: '2026', leagueId: 'p1', draftId: 'd1', draft: { status: 'complete', type: 'snake', settings: { rounds: 15, pick_timer: 90, cpu_autopick: 1, player_type: 1 } } },
          { season: '2025', leagueId: 'p0', draftId: null, draft: null },
        ] }
      : u.includes('/picks') ? { picks: [{ player_id: '4046' }] }
        : u.includes('api.sleeper.app') ? { season: '2025', name: 'Old League', previous_league_id: null }
          : u.includes('/api/discord/league') ? { botConfigured: true, missingPermissions: ['Manage Webhooks'], discordConnected: true, channel: { channelName: 'league', guildName: 'Our Server', syncEnabled: false, syncOutbound: false, channelUrl: 'https://discord.com/x' } }
            : {}
    return { ok: true, status: 200, json: async () => body }
  }))
}

/**
 * The English the panels used to print. Word-bounded, case-sensitive, per text node / attribute.
 * Not listed on purpose — the Spanish dictionary keeps them as the product's terms, so they are
 * correct in Spanish: "Toilet bowl", "Bracket" (as in «Bracket de consolación»), "Drafts", "Taxi".
 */
const FORMER_ENGLISH = [
  'League snapshot', 'League name', 'Sport', 'Season', 'Scoring', 'Waiver type', 'Rolling waivers', 'FAAB budget', 'Playoff teams',
  'Playoff start week', 'Trade deadline week', 'Open full settings', 'Roster spots', 'Position limits', 'IR slots', 'Taxi slots', 'Quarterback',
  'Running Back', 'Wide Receiver', 'Tight End', 'Defensive Linemen', 'Bench', 'Open roster settings', 'Playoffs start week', 'Two week championship',
  'Re-seed each round', 'Consolation bracket', 'Seeding rules', 'Lower bracket', 'Playoff rounds', 'Week', 'On', 'Edit playoff settings',
  'Draft ID', 'Status', 'Scheduled', 'View Draft Board', 'Mock Draft', 'COMPLETE', 'Snake Draft', 'Rounds', 'Rookies Only', 'Mins', 'CPU Autopick',
  'Type', 'Player pool', 'Time / pick', 'Autopick', 'No draft', 'Per-season drafts', 'Edits stay on the host', 'Picks (synced draft id)',
  'Export picks', 'Your notification settings', 'Open notification settings', 'Members', 'teams', 'Copy link', 'Invite metadata', 'Search usernames',
  'Co-owners', 'Co-owner invites', 'Manage co-owners', 'Previous leagues', 'Open in Sleeper', 'Add trophies', 'Updates AllFantasy', 'Public league',
  'Week focus', 'Extra context', 'Generate with Chimmy', 'Post / Update', 'These tools live', 'Edit Playoff Bracket', 'Update Commissioner',
  'Roster & draft picks', 'Lock roster', 'Edit matchup scores', 'Edit waiver', 'Edit lineups', 'Schedule matchups', 'Danger zone', 'Reset league',
  'Delete / remove', 'Nuke on the host', 'Back', 'Press Escape', 'Only past weeks', 'Choose a team below', 'Open commissioner tools', 'Track dues',
  'For tracking only', 'Save', 'Preference is stored', 'Trade health review', 'Players you give', 'Players you get', 'Run', 'Team name', 'This league is imported',
  'Upload avatar', 'Audit logging', 'League rules', 'Read-only snapshot', 'Edit', 'Roster construction', 'starts week', 'Daily waivers',
  'Clear waivers', 'Waivers & budget', 'Roster slots', 'Injured reserve', 'Trade deadline', 'Synced from your host', 'Open full league settings',
  'Scoring Settings', 'Values are synced', 'Flavor hint', 'All scoring rules', 'Popular presets', 'Apply ESPN-style', 'Reset to default', 'Open full scoring editor',
  'Your league’s Discord', 'League chat copying', 'Open in Discord', 'Discord is missing permissions', 'This server never gave', 'Add AllFantasy again', 'Manage Discord',
]
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[placeholder],[title],[aria-label]')) parts.push(e.getAttribute('placeholder') ?? '', e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const hay = parts.join(' | ')
  return FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}

describe('🛑 the panels read Spanish in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  const panel = async (panelId: string, waitFor: string, c = ctx()) => {
    lang.language = 'es'
    stubFetch()
    const r = render(<SettingsSubPanelBody panelId={panelId} ctx={c} />)
    await r.findAllByText((_, el) => (el?.textContent ?? '').includes(waitFor))
    return r
  }

  it.each([
    ['general-info', 'Resumen de la liga', ['Nombre de la liga', 'Deporte', 'Waivers rotativos', 'Presupuesto FAAB', 'Semana límite de trades', 'Abrir todos los ajustes en Sleeper →']],
    ['roster', 'Puestos de plantilla', ['Mariscal de campo (QB)', 'Corredor (RB)', 'Puestos de plantilla IDP', 'Linieros defensivos (DL)', 'Banca (BN)', 'Puestos de IR', 'Puestos de taxi']],
    ['playoffs', 'Semana de inicio de playoffs', ['Semana 15', 'Final de dos semanas', 'Resembrar en cada ronda', 'Bracket de consolación', 'Activado']],
    ['draft', 'Ver tablero del draft', ['ID del draft', 'Estado', 'Programado', 'Mock draft']],
    ['draft-results-commish', 'COMPLETADO', ['Draft serpiente', '15 rondas', 'Solo novatos', '2 min', 'Autoselección CPU', 'Sin draft', 'Los cambios se hacen en la app anfitriona.', 'Exportar picks como CSV (portapapeles)']],
    ['notifications', 'Abrir ajustes de notificaciones', ['«Ajustes por liga»']],
    ['invite', 'Copiar enlace', ['Miembros', '1 / 12 equipos']],
    ['co-owners', 'Co-propietarios', ['Gestionar co-propietarios en Sleeper →']],
    ['league-history-commish', 'Ligas anteriores', ['Abrir en Sleeper →', 'Agrega trofeos']],
    ['commish-general', 'Liga pública', ['Nombre de la liga', 'Actualiza AllFantasy']],
    ['commish-note', 'Generar con Chimmy', ['Semana de enfoque (opcional)', 'Publicar / Actualizar']],
    ['commish-controls', 'Zona de peligro', ['Editar bracket de playoffs', 'Bloquear plantilla', 'Programar matchups', 'Reiniciar liga', 'Eliminar / quitar']],
    ['league-dues', 'Seguimiento de cuotas', ['Seguimiento de Cuotas de Liga', 'Guardar']],
    ['ai-trade', 'Revisión de salud de trades', ['Jugadores que das (separados por comas)', 'Jugadores que recibes', 'Ejecutar']],
    ['ai-trash', 'Idea de rivalidad', ['Nombre visible del objetivo', 'Intensidad', 'Brutal']],
    ['my-team', 'Nombre del equipo', ['Esta liga está importada']],
    ['audit-log', 'Registro de auditoría', ['El registro de auditoría está listo para conectarse.']],
    ['discord-sync', 'El Discord de tu liga', ['en Our Server', 'La copia del chat de la liga está desactivada.', 'A Discord le faltan permisos', 'Este servidor nunca le dio a AllFantasy', 'Añadir AllFantasy de nuevo', 'Gestionar Discord →']],
  ])('%s', async (panelId, waitFor, expected) => {
    const r = await panel(panelId as string, waitFor as string)
    const text = r.container.textContent ?? ''
    for (const s of expected as string[]) expect(text, s).toContain(s)
    expect(englishIn(r.container)).toEqual([])
  })

  it('commish-controls, a tool opened — back, hints, the team list, its host link', async () => {
    const r = await panel('commish-controls', 'Zona de peligro')
    fireEvent.click(r.getByTestId('commish-tile-edit-lineups'))
    await r.findByText('Elige un equipo abajo y termina los cambios de alineación en las herramientas de comisionado de tu app anfitriona.')
    for (const s of ['Atrás', 'Equipos', 'Abrir herramientas de comisionado en Sleeper →']) expect(r.container.textContent, s).toContain(s)
    expect(englishIn(r.container)).toEqual([])
  })

  it('the rules summary and the full scoring section', async () => {
    lang.language = 'es'
    const c = ctx() as unknown as { league: never; displayLeague: never }
    const r = render(<>
      <LeagueRulesSummarySection league={c.league} displayLeague={c.displayLeague} sleeperSettingsHref="https://sleeper.com/x" showEditLink />
      <ScoringSettingsFullSection league={c.league} sleeperSettingsHref="https://sleeper.com/x" showEditLink />
    </>)
    for (const s of ['Reglas de la liga', 'Vista de solo lectura', 'Composición de la plantilla', '6 equipos, empieza la semana 15', 'Waivers diarios',
      'Waivers y presupuesto', 'Waivers rotativos', 'Reserva de lesionados', 'Semana 11', 'Ajustes de puntuación', 'Tipo detectado:', 'Todas las reglas de puntuación',
      'Ajustes predefinidos populares', 'Aplica la puntuación estilo ESPN', 'Restablecer']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(englishIn(r.container)).toEqual([])
  })

  it('…and the same panels still read English in English', async () => {
    stubFetch()
    const r = render(<>
      <SettingsSubPanelBody panelId="general-info" ctx={ctx()} />
      <SettingsSubPanelBody panelId="playoffs" ctx={ctx()} />
      <SettingsSubPanelBody panelId="commish-controls" ctx={ctx()} />
    </>)
    for (const s of ['League snapshot', 'Rolling waivers', 'Playoffs start week', 'Week 15', 'Two week championship', 'On', 'Edit Playoff Bracket', 'Danger zone',
      'These tools live on your fantasy host (e.g. Sleeper). Tap a tile for a team list (where it applies), then finish in the host app. All seven supported sports use the same host pattern when integrated.']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(r.container.textContent).not.toMatch(/\blsPanel\.|\blsModal\./)
  })
})
