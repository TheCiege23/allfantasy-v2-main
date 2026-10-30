/** What AllFantasy may do for a manager's own team (phase 11, 2026-10-29). */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  league: null as null | Record<string, unknown>,
  roster: null as null | { id: string },
  plan: true,
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: async () => m.league }, roster: { findFirst: async () => m.roster } } }))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: async () => m.plan }))

import { myTeamAutomations } from '@/lib/lineup-automation/myTeamAutomations'
import { readMyTeamAutomations } from '@/lib/lineup-automation/myTeamAutomationsService'
import { MyTeamAutomations } from '@/components/league/native/screens/MyTeamAutomations'

const keys = (r: ReturnType<typeof myTeamAutomations>) => r.items.map((i) => i.key)
const facts = (over: Partial<Parameters<typeof myTeamAutomations>[0]> = {}) => ({ settings: {}, weeklyLineups: true, commissionerPlan: true, managed: null, ...over })

describe('myTeamAutomations', () => {
  it('lists what may act on the team, in both languages', () => {
    const r = myTeamAutomations(facts({ settings: { inactive_auto_handover: { days: 14, to: 'lineups', since: '2026-10-01T00:00:00.000Z', byUserId: 'c' }, ir_auto_move: { enabled: true }, eliminated_lineup_minimum: { enabled: true, standard: 'playable', autoFill: true } } }))
    expect(keys(r)).toEqual(['fill_empty_starters', 'auto_handover', 'draft_as_me', 'eliminated_lineups', 'ir_auto_move'])
    expect(r.items.find((i) => i.key === 'auto_handover')!.en).toBe('If you have no activity for 14 days, your team is handed to AllFantasy until you are back.')
    for (const i of r.items) expect(i.es.length).toBeGreaterThan(0)
  })

  it('without AF Commissioner only the free ones; without weekly lineups no lineup filling', () => {
    expect(keys(myTeamAutomations(facts({ commissionerPlan: false, settings: { ir_auto_move: { enabled: true } } })))).toEqual(['fill_empty_starters'])
    expect(keys(myTeamAutomations(facts({ weeklyLineups: false })))).toEqual(['draft_as_me'])
    expect(keys(myTeamAutomations(facts({ commissionerPlan: false, settings: { fill_empty_starters: false } })))).toEqual([])
  })

  it('while the team is being run, says so first and how to take it back', () => {
    const r = myTeamAutomations(facts({ managed: { autopilot: true }, settings: { inactive_auto_handover: { days: 7, to: 'autopilot', since: '2026-10-01T00:00:00.000Z', byUserId: 'c' } } }))
    expect(keys(r)[0]).toBe('managed')
    expect(keys(r)).not.toContain('auto_handover')
    expect(r.takeBack.en).toBe('Save a lineup of your own and you are in charge again at once.')
  })
})

describe('readMyTeamAutomations', () => {
  beforeEach(() => {
    m.league = { userId: 'owner', platform: 'allfantasy', sport: 'NFL', settings: { af_managed_lineups: { r1: { since: 's', byUserId: 'c', ownerUserId: 'me' } } }, leagueType: 'dynasty', bestBallMode: false }
    m.roster = { id: 'r1' }
    m.plan = true
  })

  it('reads the signed-in owner’s team, including that AllFantasy is running it', async () => {
    const v = await readMyTeamAutomations('L', 'me')
    expect(v.available && v.items[0]!.key).toBe('managed')
  })

  it('a mode switched on for a previous owner does not speak for this one', async () => {
    const v = await readMyTeamAutomations('L', 'new-owner')
    expect(v.available && v.items.map((i) => i.key)).not.toContain('managed')
  })

  it('nothing for an imported league or a non-owner', async () => {
    m.league = { ...m.league!, platform: 'sleeper' }
    expect(await readMyTeamAutomations('L', 'me')).toEqual({ available: false, reason: 'not_native' })
    m.roster = null
    expect(await readMyTeamAutomations('L', 'me')).toEqual({ available: false, reason: 'no_team' })
  })
})

describe('MyTeamAutomations', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists the items, opened while AllFantasy runs the team; hidden when nothing applies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: true, items: [{ key: 'managed', en: 'AllFantasy is setting your lineup right now, while you are away.', es: 'x' }], takeBack: { key: 'take_back', en: 'Save a lineup of your own and you are in charge again at once.', es: 'y' } }) })))
    render(<MyTeamAutomations leagueId="L" />)
    const box = await screen.findByTestId('my-team-automations')
    expect((box as HTMLDetailsElement).open).toBe(true)
    expect(screen.getByTestId('my-automation-managed').textContent).toContain('AllFantasy is setting your lineup')
  })

  it('renders nothing when there is nothing to say', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ available: true, items: [], takeBack: { key: 'take_back', en: '', es: '' } }) }))
    vi.stubGlobal('fetch', f)
    const { container } = render(<MyTeamAutomations leagueId="L" />)
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    // Let the response land and React render it before judging an empty result.
    await new Promise((r) => setTimeout(r, 30))
    expect(container.querySelector('[data-testid="my-team-automations"]')).toBeNull()
  })
})
