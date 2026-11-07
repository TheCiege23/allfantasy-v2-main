/**
 * Guilly War Room: the league's own panel comes first (2026-11-06). In a Guilly league the tab opened on the generic
 * "AF Legacy" header and the plan upsell ("Why AF Legacy", three tier cards), so on a 390px phone the survival panel
 * — elimination risk, this week's plan, survival standings — started a full screen and a half down. The panel now
 * sits directly under the header, the upsell follows it, and the header says it is the Guilly war room for this week.
 * Other formats keep their order; this is scoped to Guilly.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/hooks/useLeagueWarRoomCompanion', () => ({
  useLeagueWarRoomCompanion: () => ({ error: null, copilot: null, intelligence: null, copilotEmptyMessage: null, loading: false, refresh: async () => {} }),
}))
const { stub } = vi.hoisted(() => ({
  stub: (id: string) => () => React.createElement('div', { 'data-testid': id }),
}))
vi.mock('@/components/monetization/AFWarRoomPlanSpotlight', () => ({ AFWarRoomPlanSpotlight: stub('stub-plan-spotlight') }))
vi.mock('@/components/meta-insights/WarRoomMetaWidget', () => ({ default: stub('stub-meta') }))
vi.mock('@/components/war-room', () => ({ WarRoomPanel: stub('stub-generic-war-room') }))
vi.mock('@/app/league/[leagueId]/tabs/redraft/RedraftWarRoomPanel', () => ({ RedraftWarRoomPanel: stub('stub-redraft-panel') }))
vi.mock('@/app/league/[leagueId]/tabs/dynasty/DynastyWarRoomPanel', () => ({ DynastyWarRoomPanel: stub('stub-dynasty-panel') }))
vi.mock('@/app/league/[leagueId]/tabs/keeper/KeeperWarRoomPanel', () => ({ KeeperWarRoomPanel: stub('stub-keeper-panel') }))
vi.mock('@/app/league/[leagueId]/tabs/best-ball/BestBallWarRoomPanel', () => ({ BestBallWarRoomPanel: stub('stub-bestball-panel') }))
vi.mock('@/app/league/[leagueId]/tabs/guillotine/GuillotineWarRoomPanel', () => ({ GuillotineWarRoomPanel: stub('stub-guillotine-panel') }))
vi.mock('@/components/zombie/ZombieWarRoomShortcuts', () => ({ ZombieWarRoomShortcuts: stub('stub-zombie') }))
vi.mock('@/components/subscription/FeatureGate', () => ({ FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import { WarRoomTab } from '@/app/league/[leagueId]/tabs/WarRoomTab'

const base = {
  id: 'L', name: 'Last Team Standing', platform: 'allfantasy', sport: 'NFL', scoring: 'Half PPR', teamCount: 12, season: 2026,
  lifecycleState: 'in_season', currentWeek: 4, isDynasty: false, isCommissioner: true,
}
const GUILLY = { ...base, format: 'redraft', leagueType: 'redraft', leagueVariant: 'guillotine', guillotineMode: true }
const REDRAFT = { ...base, format: 'redraft', leagueType: 'redraft' }

/** Document order of two test ids: negative when `a` comes first. */
function order(a: string, b: string): number {
  const pa = screen.getByTestId(a)
  const pb = screen.getByTestId(b)
  return pa.compareDocumentPosition(pb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}

afterEach(cleanup)

describe('Guilly War Room order', () => {
  it('the Guilly panel comes before the plan upsell and the generic tools', () => {
    render(<WarRoomTab league={GUILLY as never} sport="NFL" />)
    expect(screen.getAllByTestId('stub-guillotine-panel')).toHaveLength(1)
    expect(order('stub-guillotine-panel', 'stub-plan-spotlight')).toBe(-1)
    expect(order('stub-guillotine-panel', 'stub-generic-war-room')).toBe(-1)
  })

  it('nothing but the header sits above the Guilly panel', () => {
    render(<WarRoomTab league={GUILLY as never} sport="NFL" />)
    const panel = screen.getByTestId('stub-guillotine-panel')
    const tab = screen.getByTestId('league-war-room-tab')
    // Walk up to the tab's direct child that holds the panel; every earlier sibling must be the header.
    let el: HTMLElement = panel
    while (el.parentElement && el.parentElement !== tab) el = el.parentElement
    const before = Array.from(tab.children).slice(0, Array.from(tab.children).indexOf(el))
    expect(before.map((n) => n.tagName.toLowerCase())).toEqual(['header'])
  })

  it('the header names the Guilly war room and the week', () => {
    render(<WarRoomTab league={GUILLY as never} sport="NFL" />)
    expect(screen.getByTestId('league-war-room-tab').querySelector('header')?.textContent).toContain('Guilly war room · NFL · Week 4')
  })

  it('other formats keep their order: a redraft league still opens on the upsell', () => {
    render(<WarRoomTab league={REDRAFT as never} sport="NFL" />)
    expect(screen.queryByTestId('stub-guillotine-panel')).toBeNull()
    expect(order('stub-plan-spotlight', 'stub-redraft-panel')).toBe(-1)
  })
})
