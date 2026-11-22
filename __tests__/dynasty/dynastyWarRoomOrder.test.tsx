/**
 * Dynasty War Room: the league's own panel comes first (2026-11-06, dynasty audit item 7). In a dynasty league the
 * tab opened on the generic "AF Legacy" header and the plan upsell ("Why AF Legacy" and three tier cards), and the
 * dynasty panel — the part about this league — came after them: on a 390px phone it began below the first screen
 * and a half. The panel now sits directly under the header, the upsell follows it, and the header names the
 * dynasty war room and the week. Other formats keep their order. (Guilly gets the same treatment in its own PR.)
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
  id: 'L', name: 'Forever Dynasty', platform: 'allfantasy', sport: 'NFL', scoring: 'Half PPR', teamCount: 12, season: 2026,
  lifecycleState: 'in_season', currentWeek: 9, isCommissioner: true,
}
const DYNASTY = { ...base, format: 'dynasty', leagueType: 'dynasty', isDynasty: true }
const REDRAFT = { ...base, name: 'Sunday Night Redraft', format: 'redraft', leagueType: 'redraft', isDynasty: false }

function order(a: string, b: string): number {
  return screen.getByTestId(a).compareDocumentPosition(screen.getByTestId(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}

afterEach(cleanup)

describe('Dynasty War Room order', () => {
  it('the dynasty panel comes before the plan upsell and the generic tools, once', () => {
    render(<WarRoomTab league={DYNASTY as never} sport="NFL" />)
    expect(screen.getAllByTestId('stub-dynasty-panel')).toHaveLength(1)
    expect(order('stub-dynasty-panel', 'stub-plan-spotlight')).toBe(-1)
    expect(order('stub-dynasty-panel', 'stub-generic-war-room')).toBe(-1)
  })

  it('nothing but the header sits above the dynasty panel', () => {
    render(<WarRoomTab league={DYNASTY as never} sport="NFL" />)
    const tab = screen.getByTestId('league-war-room-tab')
    let el: HTMLElement = screen.getByTestId('stub-dynasty-panel')
    while (el.parentElement && el.parentElement !== tab) el = el.parentElement
    const before = Array.from(tab.children).slice(0, Array.from(tab.children).indexOf(el))
    expect(before.map((n) => n.tagName.toLowerCase())).toEqual(['header'])
  })

  it('the header names the dynasty war room and the week', () => {
    render(<WarRoomTab league={DYNASTY as never} sport="NFL" />)
    expect(screen.getByTestId('league-war-room-tab').querySelector('header')?.textContent).toContain('Dynasty war room · NFL · Week 9')
  })

  it('control: a redraft league still opens on the upsell, then its own panel', () => {
    render(<WarRoomTab league={REDRAFT as never} sport="NFL" />)
    expect(screen.queryByTestId('stub-dynasty-panel')).toBeNull()
    expect(order('stub-plan-spotlight', 'stub-redraft-panel')).toBe(-1)
  })
})
