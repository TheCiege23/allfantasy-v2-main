/**
 * Commissioner Settings nav: lucide icons for every league, League / Dynasty / People groups for a
 * dynasty league, and the taxi squad's "What this changes" panel and over-the-limit warning.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  SettingsNav,
  TAXI_SECTION_ANCHOR,
  activeNavKey,
  buildSettingsNavGroups,
  type SettingsNavTabId,
} from '@/app/league/[leagueId]/components/settings/SettingsNav'
import { TaxiLockWarning, TaxiRulesExplainer } from '@/app/league/[leagueId]/components/settings/TaxiRulesExplainer'
import { taxiRulesInPlainWords, teamsOverTaxiLimit } from '@/lib/taxi/taxiRulesPlainWords'
import { translations } from '@/lib/i18n/translations'

afterEach(cleanup)

/** The list the nav has always shown, in order — a non-dynasty league must keep exactly this. */
const FLAT_LABELS = [
  'General', 'Team', 'Roster', 'Scoring', 'Draft', 'Divisions', 'Members', 'Co-owners', 'Trades', 'Waivers',
  'Playoffs', 'Schedule', 'Commissioner Intelligence', 'Notifications', 'Payments / League Dues', 'Import / Sync',
  'Advanced Rule Support', 'Appearance / Branding', 'Permissions', 'Draft Pick Settings', 'Integrations',
  'Commissioner Control', 'Previous Leagues', 'Delete League',
]
const BASE_IDS: SettingsNavTabId[] = [
  'league', 'team', 'roster', 'scoring', 'draft', 'divisions', 'members', 'coowners', 'trade', 'waiver', 'playoff',
  'schedule', 'ai', 'notifications', 'dues', 'import_sync', 'advanced', 'appearance', 'security', 'draft_picks',
  'integrations', 'commissioner', 'previous', 'delete',
]
const EMOJI = /\p{Extended_Pictographic}/u

const nav = (over: Record<string, unknown> = {}) => {
  const onSelect = vi.fn()
  const r = render(<SettingsNav activeTab="league" onSelect={onSelect} saveStatus={'idle' as never} {...over} />)
  return { ...r, onSelect }
}

describe('a league that is not dynasty', () => {
  it('keeps the same flat list in the same order, with no headings', () => {
    const groups = buildSettingsNavGroups({})
    expect(groups).toHaveLength(1)
    expect(groups[0]!.headingKey).toBeUndefined()
    expect(groups[0]!.items.map((i) => i.label)).toEqual(FLAT_LABELS)
    expect(groups[0]!.items.map((i) => i.id)).toEqual(BASE_IDS)

    nav()
    expect(screen.queryByTestId('settings-nav-dynasty')).toBeNull()
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(FLAT_LABELS)
  })

  it('appends the format tabs in the same order as before, all without emoji', () => {
    const all = buildSettingsNavGroups({
      showSurvivorTabs: true, showZombieTabs: true, showIdpTabs: true, showDevyTabs: true, showC2cTabs: true,
      showNativeDevyTab: true, showNativeC2cTab: true,
    })[0]!.items
    const ids = all.map((i) => i.id)
    expect(ids.slice(0, 24)).toEqual(BASE_IDS)
    expect(ids.indexOf('survivor_setup')).toBeLessThan(ids.indexOf('zombie_setup'))
    expect(ids.indexOf('zombie_ai')).toBeLessThan(ids.indexOf('idp_roster'))
    expect(ids.indexOf('idp_cap')).toBeLessThan(ids.indexOf('devy_format'))
    expect(ids.indexOf('devy_ai')).toBeLessThan(ids.indexOf('c2c_format'))
    expect(ids.slice(-2)).toEqual(['native_devy', 'native_c2c'])
    for (const i of all) {
      expect(i.label, i.id).toBeTruthy()
      expect(EMOJI.test(i.label!), `${i.id}: ${i.label}`).toBe(false)
    }
  })

  it('draws a lucide icon on every row, hidden from screen readers', () => {
    const { container } = nav({ showZombieTabs: true })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(24 + 13)
    for (const b of buttons) expect(b.querySelector('svg.lucide[aria-hidden="true"]')).not.toBeNull()
    expect(EMOJI.test(container.textContent ?? '')).toBe(false)
    expect(screen.getByRole('button', { name: 'Zombie Setup' })).toBeTruthy()
    for (const name of ['Automation', 'Overrides', 'Audit Log']) expect(screen.getByRole('button', { name, exact: true })).toBeTruthy()
  })

  it('the source carries no emoji label at all', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/components/settings/SettingsNav.tsx'), 'utf8')
    expect(EMOJI.test(src)).toBe(false)
  })
})

describe('a dynasty league', () => {
  it('groups the nav into League / Dynasty / People, every base tab once', () => {
    const groups = buildSettingsNavGroups({ dynasty: true })
    expect(groups.map((g) => g.headingKey)).toEqual(['settingsNav.group.league', 'settingsNav.group.dynasty', 'settingsNav.group.people'])
    expect(groups.find((g) => g.key === 'dynasty')!.accent).toBe(true)
    const rows = groups.flatMap((g) => g.items).filter((i) => i.key !== 'dyn_taxi')
    expect(rows.map((i) => i.id).sort()).toEqual([...BASE_IDS].sort())
  })

  it('the Dynasty group maps to the tabs that already exist', () => {
    const dyn = buildSettingsNavGroups({ dynasty: true }).find((g) => g.key === 'dynasty')!.items
    expect(dyn.map((i) => [i.labelKey, i.id, i.anchor ?? null])).toEqual([
      ['settingsNav.dynasty.format', 'roster', null],
      ['settingsNav.dynasty.taxi', 'roster', TAXI_SECTION_ANCHOR],
      ['settingsNav.dynasty.picks', 'draft_picks', null],
      ['settingsNav.dynasty.trades', 'trade', null],
      ['settingsNav.dynasty.offseason', 'advanced', null],
    ])
  })

  it('shows Devy & prospects only when a native Devy or C2C editor answers', () => {
    const devyIds = (o: Record<string, boolean>) =>
      buildSettingsNavGroups({ dynasty: true, ...o }).find((g) => g.key === 'dynasty')!.items.filter((i) => i.key === 'dyn_devy').map((i) => i.id)
    expect(devyIds({})).toEqual([])
    expect(devyIds({ showNativeDevyTab: true })).toEqual(['native_devy'])
    expect(devyIds({ showNativeC2cTab: true })).toEqual(['native_c2c'])
    // Never listed twice: the native tabs move into the Dynasty group instead of trailing it.
    const all = buildSettingsNavGroups({ dynasty: true, showNativeDevyTab: true, showNativeC2cTab: true }).flatMap((g) => g.items)
    expect(all.filter((i) => i.id === 'native_devy')).toHaveLength(1)
    expect(all.filter((i) => i.id === 'native_c2c')).toHaveLength(1)
  })

  it('keeps the legacy format tab sets as their own groups', () => {
    const groups = buildSettingsNavGroups({ dynasty: true, showDevyTabs: true, showIdpTabs: true })
    expect(groups.map((g) => g.key)).toEqual(['league', 'dynasty', 'people', 'idp', 'devy'])
  })

  it('renders the group headings and the Dynasty labels in English', () => {
    nav({ dynasty: true, showNativeDevyTab: true })
    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toEqual(['settings-nav-group-league', 'settings-nav-group-dynasty', 'settings-nav-group-people'])
    const dynasty = within(groups[1]!)
    expect(dynasty.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Format & roster', 'Taxi squad', 'Devy & prospects', 'Rookie draft & picks', 'Trades', 'Offseason & rollover',
    ])
    expect(screen.getByText('Dynasty')).toBeTruthy()
    expect(screen.getByText('People')).toBeTruthy()
  })

  it('Taxi squad opens the Roster tab, lights itself, and scrolls to the taxi section', () => {
    const scroll = vi.fn()
    const target = document.createElement('section')
    target.id = TAXI_SECTION_ANCHOR
    target.scrollIntoView = scroll
    document.body.appendChild(target)
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
    const { onSelect, rerender } = nav({ dynasty: true })
    fireEvent.click(screen.getByRole('button', { name: 'Taxi squad' }))
    expect(onSelect).toHaveBeenCalledWith('roster')
    expect(scroll).toHaveBeenCalledTimes(1)
    rerender(<SettingsNav activeTab="roster" onSelect={onSelect} saveStatus={'idle' as never} dynasty />)
    expect(screen.getByRole('button', { name: 'Taxi squad' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Format & roster' }).getAttribute('aria-current')).toBeNull()
    raf.mockRestore()
    target.remove()
  })

  it('the first row for a tab is lit when none was clicked', () => {
    const items = buildSettingsNavGroups({ dynasty: true }).flatMap((g) => g.items)
    expect(activeNavKey(items, 'roster', null)).toBe('dyn_format')
    expect(activeNavKey(items, 'roster', 'dyn_taxi')).toBe('dyn_taxi')
    // A click on another tab's row no longer counts once the tab has moved on.
    expect(activeNavKey(items, 'roster', 'dyn_trades')).toBe('dyn_format')
  })

  it('the modal decides dynasty with usesDynastyBackground', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/components/CommissionerSettingsModal.tsx'), 'utf8')
    expect(src).toMatch(/dynasty=\{usesDynastyBackground\(leagueRow/)
  })
})

describe('the new strings', () => {
  const keys = Object.keys(translations.en).filter((k) => k.startsWith('settingsNav.') || k.startsWith('taxiPanel.'))
  it('exist in English and Spanish', () => {
    expect(keys.length).toBe(28)
    for (const k of keys) {
      expect(translations.es[k], k).toBeTruthy()
    }
    expect(translations.es['settingsNav.group.dynasty']).toBe('Dinastía')
    expect(translations.es['taxiPanel.title']).toBe('Qué cambia esto')
  })
  it('the Spanish never says waiver', () => {
    for (const k of keys) expect(translations.es[k]!.toLowerCase(), k).not.toContain('waiver')
  })
})

describe('What this changes', () => {
  it('says the current values in plain words', () => {
    expect(taxiRulesInPlainWords({ slots: 0, yearsLimit: 2, allowNonRookies: true })).toEqual([{ key: 'taxiPanel.off' }])
    expect(taxiRulesInPlainWords({ slots: 1, yearsLimit: 0, allowNonRookies: true })).toEqual([{ key: 'taxiPanel.slotsOne' }, { key: 'taxiPanel.yearsAny' }])
    expect(taxiRulesInPlainWords({ slots: 4, yearsLimit: 2, allowNonRookies: true })).toEqual([
      { key: 'taxiPanel.slots', vars: { count: 4 } },
      { key: 'taxiPanel.years', vars: { count: 2 } },
    ])
    expect(taxiRulesInPlainWords({ slots: 3, yearsLimit: 1, allowNonRookies: true })[1]).toEqual({ key: 'taxiPanel.yearsOne' })
    // Rookie-only: the experience cap cannot bite (the validator refuses any experience first).
    expect(taxiRulesInPlainWords({ slots: 3, yearsLimit: 2, allowNonRookies: false })).toEqual([
      { key: 'taxiPanel.slots', vars: { count: 3 } },
      { key: 'taxiPanel.rookiesOnly' },
    ])
  })

  it('renders the English copy, with Chimmy', () => {
    render(<TaxiRulesExplainer slots={4} yearsLimit={2} allowNonRookies />)
    const panel = screen.getByTestId('taxi-what-this-changes')
    expect(within(panel).getByRole('heading', { name: 'What this changes' })).toBeTruthy()
    expect(panel.textContent).toContain('Each team can stash up to 4 players on its taxi squad.')
    expect(panel.textContent).toContain('A player can go on it with up to 2 years of experience.')
    expect(panel.textContent).toContain('Chimmy reads the saved slot count')
    expect(panel.textContent).not.toContain('{{')
  })

  it('renders the off state', () => {
    render(<TaxiRulesExplainer slots={0} yearsLimit={2} allowNonRookies={false} />)
    expect(screen.getByTestId('taxi-what-this-changes').textContent).toContain('The taxi squad is off')
  })

  it('shows no chat preview: settings saves do not post to league chat', () => {
    render(<TaxiRulesExplainer slots={4} yearsLimit={2} allowNonRookies />)
    expect(screen.getByTestId('taxi-what-this-changes').textContent).not.toMatch(/chat will say/i)
  })
})

describe('the over-the-limit warning', () => {
  const held = [{ teamName: 'Wolves', count: 4 }, { teamName: 'Hawks', count: 2 }, { teamName: 'Owls', count: 5 }]

  it('names how many teams a lower count leaves over', () => {
    expect(teamsOverTaxiLimit(held, 3)).toEqual(['Wolves', 'Owls'])
    render(<TaxiLockWarning held={held} slots={3} />)
    expect(screen.getByTestId('taxi-lock-warning').textContent).toContain('2 teams hold more than 3 taxi players today: Wolves, Owls.')
  })

  it('uses the singular for one team and the off wording at 0', () => {
    const { unmount } = render(<TaxiLockWarning held={held} slots={4} />)
    expect(screen.getByTestId('taxi-lock-warning').textContent).toContain('1 team holds more than 4 taxi players today: Owls.')
    unmount()
    render(<TaxiLockWarning held={held} slots={0} />)
    expect(screen.getByTestId('taxi-lock-warning').textContent).toContain('3 teams still hold taxi players: Wolves, Hawks, Owls.')
  })

  it('is absent when no team is over, or when the counts are unknown', () => {
    const { container, rerender } = render(<TaxiLockWarning held={held} slots={5} />)
    expect(container.innerHTML).toBe('')
    rerender(<TaxiLockWarning held={null} slots={0} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('the taxi section wiring', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/components/settings/TaxiSquadSettingsSection.tsx'), 'utf8')
  it('shows the panel and the warning for a dynasty league only', () => {
    expect(src).toMatch(/const isDynastyLeague = usesDynastyBackground\(initialData\)/)
    expect(src).toMatch(/\{isDynastyLeague \? \(\s*<TaxiRulesExplainer slots=\{taxiSlots\} yearsLimit=\{taxiYears\} allowNonRookies=\{taxiNonRookies\} \/>/)
    expect(src).toMatch(/\{isDynastyLeague \? <TaxiLockWarning held=\{taxiHeld\} slots=\{taxiSlots\}/)
    expect(src).toMatch(/useTaxiHeld\(leagueId, isDynastyLeague && canEdit\)/)
  })
})
