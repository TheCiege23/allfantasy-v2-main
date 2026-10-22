/**
 * League Settings, part 2 (2026-10-18): one place for every setting on a native league.
 * Every old entry (settings-modal panel ids, ?settingsPanel= deep links, /league/:id/settings,
 * the commissioner workspace buttons) resolves to the League Settings page or one of its
 * sub-pages; long row values wrap instead of being cut off with an ellipsis.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  LEGACY_SETTINGS_PANEL_TO_SUB_PAGE,
  SETTINGS_SUB_PAGE_IDS,
  leagueSettingsHomeHref,
  legacySettingsRouteQuery,
  resolveLegacySettingsPanel,
} from '@/lib/league-settings-home/settingsEntryRouting'
import {
  buildLeagueSettingsHome,
  isLongSettingsValue,
  type BuildSettingsHomeInput,
} from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { SUB_PAGE_TITLES } from '@/components/league-settings/home/LeagueSettingsSubPageTitles'
import { LeagueSettingsHome } from '@/components/league-settings/home/LeagueSettingsHome'

const redirect = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect }))

const root = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

describe('resolveLegacySettingsPanel: old settings entries → the League Settings page', () => {
  it.each([
    // LeagueSettingsModal cards + control-center tab ids
    ['general-info', 'general'],
    ['commish-general', 'general'],
    ['roster', 'roster'],
    ['scoring', 'scoring'],
    ['draft', 'draft'],
    ['playoffs', 'playoffs'],
    ['members-commish', 'members'],
    ['division-settings', 'divisions'],
    ['commish-controls', 'commissioner-tools'],
    ['league-dues', 'commissioner-tools'],
    ['league-history-commish', 'commissioner-tools'],
    ['commissioner', 'commissioner-tools'],
    ['permissions', 'commissioner-tools'],
    ['conceptRules', 'format'],
    ['devy-command-center', 'format'],
    ['ai', 'ai'],
    // CommissionerOperationsWorkspace "Trade Settings" passes the singular
    ['trade', 'trades'],
    ['waivers', 'waivers'],
  ])('%s → %s', (panel, target) => {
    expect(resolveLegacySettingsPanel(panel)).toBe(target)
  })

  it('no panel (header gear, ?view=settings) → the list itself', () => {
    expect(resolveLegacySettingsPanel(null)).toBeNull()
    expect(resolveLegacySettingsPanel(undefined)).toBeNull()
    expect(resolveLegacySettingsPanel('  ')).toBeNull()
    expect(resolveLegacySettingsPanel('settings')).toBeNull()
  })

  it('is case-insensitive (old links capitalised the tab: ?tab=Settings)', () => {
    expect(resolveLegacySettingsPanel('Draft')).toBe('draft')
    expect(resolveLegacySettingsPanel('COMMISH-CONTROLS')).toBe('commissioner-tools')
  })

  it('every sub-page id resolves to itself, so new links can name the sub-page', () => {
    for (const id of SETTINGS_SUB_PAGE_IDS) expect(resolveLegacySettingsPanel(id)).toBe(id)
  })

  it.each(['my-team', 'invite', 'notifications', 'co-owners', 'commish-note', 'draft-results', 'audit-log', 'ai-trade', 'idp_roster', 'discord-sync'])(
    '%s is not a league setting: undefined keeps the old panel',
    (panel) => {
      expect(resolveLegacySettingsPanel(panel)).toBeUndefined()
    },
  )

  it('every mapped target is a real sub-page with a title', () => {
    for (const target of Object.values(LEGACY_SETTINGS_PANEL_TO_SUB_PAGE)) {
      if (target === null) continue
      expect(SETTINGS_SUB_PAGE_IDS).toContain(target)
      expect(SUB_PAGE_TITLES[target]).toBeTruthy()
    }
  })

  it('every League Settings button in the commissioner workspace lands on the settings page', () => {
    const src = read('components/league-home/CommissionerOperationsWorkspace.tsx')
    const panels = [...src.matchAll(/onOpenSettings\('([^']+)'\)/g)].map((m) => m[1])
    expect(panels.length).toBeGreaterThan(5)
    // Only the invite sheet and the commissioner note are not settings — they keep their panels.
    const unrouted = panels.filter((p) => resolveLegacySettingsPanel(p) === undefined)
    expect(unrouted.sort()).toEqual(['commish-note', 'invite'])
  })
})

describe('links and redirects', () => {
  it('leagueSettingsHomeHref builds the canonical deep link', () => {
    expect(leagueSettingsHomeHref('lg 1')).toBe('/league/lg%201?view=settings')
    expect(leagueSettingsHomeHref('lg1', 'draft')).toBe('/league/lg1?view=settings&settingsPanel=draft')
  })

  it('/league/:id/settings keeps an old ?settingsPanel= / ?panel= target', () => {
    expect(legacySettingsRouteQuery({})).toBe('view=settings')
    expect(legacySettingsRouteQuery({ settingsPanel: 'draft' })).toBe('view=settings&settingsPanel=draft')
    expect(legacySettingsRouteQuery({ panel: ['roster', 'x'] })).toBe('view=settings&settingsPanel=roster')
  })

  it('the /league/:id/settings page redirects into the shell with that query', async () => {
    const { default: LeagueSettingsPage } = await import('@/app/league/[leagueId]/settings/page')
    await LeagueSettingsPage({
      params: Promise.resolve({ leagueId: 'lg1' }),
      searchParams: Promise.resolve({ settingsPanel: 'members-commish' }),
    })
    expect(redirect).toHaveBeenCalledWith('/league/lg1?view=settings&settingsPanel=members-commish')
    await LeagueSettingsPage({ params: Promise.resolve({ leagueId: 'lg2' }) })
    expect(redirect).toHaveBeenLastCalledWith('/league/lg2?view=settings')
  })

  it('🛑 the league shell routes native settings entries before opening the old modal', () => {
    const src = read('app/league/[leagueId]/LeagueShell.tsx')
    const open = src.slice(src.indexOf('const openLeagueSettingsModal = useCallback'), src.indexOf('const inviteAutoOpenedForLeague'))
    expect(open).toMatch(/^\s*if \(nativeWorkspace\) \{\s*\n\s*const target = resolveLegacySettingsPanel\(initialPanel\)/m)
    expect(open).toMatch(/^\s*setActiveTab\('settings'\)/m)
    // Imported leagues: unchanged — the modal opens with the panel.
    expect(open).toMatch(/^\s*setSettingsInitialPanel\(initialPanel\)\s*\n\s*setSettingsOpen\(true\)/m)
  })

  it('🛑 on a native league the modal never renders the commissioner control center (the duplicate editors)', () => {
    const src = read('app/league/[leagueId]/components/LeagueSettingsModal.tsx')
    expect(src).toMatch(/^\s*\) : isCommissioner && mainTab === 'general' && !onOpenSettingsHome \? \(/m)
    expect(src).toMatch(/resolveLegacySettingsPanel\(card\.id\)/)
  })
})

const teams = Array.from({ length: 12 }, (_, i) => ({ claimedByUserId: `u${i}`, isCoCommissioner: false, ownerName: `Owner ${i}` }))

function input(canEdit: boolean): BuildSettingsHomeInput {
  return {
    league: {
      id: 'lg1',
      name: 'Guilly',
      sport: 'NBA',
      leagueSize: 12,
      leagueVariant: 'guillotine',
      guillotineMode: true,
      waiverType: 'faab',
      waiverBudget: 1000,
      settings: {},
    },
    teams,
    canEdit,
    formatLabel: 'Guilly',
    scoringLabel: null,
    rosterSlots: { UTIL: 4, BN: 4 },
    draft: null,
    guillotine: { firstChopWeek: 10, endWeek: 24, locked: false },
    inviteUrl: 'https://allfantasy.ai/join?code=ABC123',
  }
}

describe('long values wrap instead of truncating', () => {
  it('isLongSettingsValue splits Sleeper-short values from the long ones', () => {
    expect(isLongSettingsValue('Week 10')).toBe(false)
    expect(isLongSettingsValue('FAAB · $1,000')).toBe(false)
    expect(isLongSettingsValue('Chop by lowest weekly score · Waivers after each chop')).toBe(true)
  })

  it('a long row is stacked, a short row stays inline', () => {
    render(<LeagueSettingsHome sections={buildLeagueSettingsHome(input(true))} canEdit renderSubPage={() => null} />)
    expect(screen.getByTestId('lsh-row-chop-schedule').getAttribute('data-layout')).toBe('stacked')
    expect(screen.getByTestId('lsh-row-invite').getAttribute('data-layout')).toBe('stacked')
    expect(screen.getByTestId('lsh-row-first-chop').getAttribute('data-layout')).toBe('inline')
    expect(screen.getByTestId('lsh-row-teams').getAttribute('data-layout')).toBe('inline')
  })

  it('the stylesheet wraps values and no longer ellipsizes them', () => {
    const css = read('components/league-settings/home/league-settings-home.css')
    const valueRule = css.slice(css.indexOf('.af-core .lsh-value {'), css.indexOf('}', css.indexOf('.af-core .lsh-value {')))
    expect(valueRule).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(valueRule).not.toMatch(/white-space:\s*nowrap/)
    expect(valueRule).toMatch(/overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/@media \(max-width: 479\.98px\) \{\s*\n\s*\.af-core \.lsh-row\[data-layout='stacked'\]/)
  })
})

describe('League AI is one of the settings now (it was only in the old control center)', () => {
  it('commissioners get a League AI row; members do not', () => {
    const commish = buildLeagueSettingsHome(input(true)).find((s) => s.id === 'commissioner')
    expect(commish?.rows.map((r) => [r.id, r.target])).toEqual([
      ['league-ai', 'ai'],
      ['commissioner-tools', 'commissioner-tools'],
      ['settings-lock', 'settings-lock'],
      ['score-adjustments', 'score-adjustments'],
    ])
    expect(buildLeagueSettingsHome(input(false)).some((s) => s.id === 'commissioner')).toBe(false)
    // Members never get a way into score adjustments.
    expect(buildLeagueSettingsHome(input(false)).flatMap((s) => s.rows).some((r) => r.target === 'score-adjustments')).toBe(false)
  })
})
