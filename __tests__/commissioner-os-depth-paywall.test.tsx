import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Commissioner OS is the AF Commissioner product (lib/commissioner-ui/commissionerOsDepth.ts). Its
 * intelligence pages lock from Oct 15; the pages a commissioner needs to run the league do not.
 *
 * 🛑 THE ADAPTER THROWS IF IT IS REACHED. A page that loads its data and THEN draws a lock has gated
 * nothing, so "locked" here means the page returned before asking for any data at all.
 */

const resolveCommissionerOsDepth = vi.hoisted(() => vi.fn())
const getDecisionOSAdapter = vi.hoisted(() => vi.fn())
vi.mock('@/lib/commissioner-ui/commissionerOsDepth', () => ({ resolveCommissionerOsDepth }))
vi.mock('@/lib/commissioner-ui/adapter', () => ({ getDecisionOSAdapter }))

import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'
import MissionControlPage from '@/app/commissioner-os/page'
import LeagueAnalyticsPage from '@/app/commissioner-os/analytics/page'
import ReportsPage from '@/app/commissioner-os/reports/page'
import LeagueHealthPage from '@/app/commissioner-os/league-health/page'
import ManagerIntelligencePage from '@/app/commissioner-os/managers/page'
import ActivityStreamPage from '@/app/commissioner-os/activity/page'
import RecommendationsPage from '@/app/commissioner-os/recommendations/page'
import AutomationCenterPage from '@/app/commissioner-os/automations/page'

const START = new Date('2026-10-15T04:00:00.000Z')

const PAID: Array<[string, () => Promise<ReactElement>, string]> = [
  ['app/commissioner-os/page.tsx', MissionControlPage, 'Mission Control'],
  ['app/commissioner-os/analytics/page.tsx', LeagueAnalyticsPage, 'League analytics'],
  ['app/commissioner-os/reports/page.tsx', ReportsPage, 'Reports'],
  ['app/commissioner-os/league-health/page.tsx', LeagueHealthPage, 'League health trends'],
  ['app/commissioner-os/managers/page.tsx', ManagerIntelligencePage, 'Manager intelligence'],
  ['app/commissioner-os/activity/page.tsx', ActivityStreamPage, 'The activity stream'],
  ['app/commissioner-os/recommendations/page.tsx', RecommendationsPage, 'Recommendations'],
  ['app/commissioner-os/automations/page.tsx', AutomationCenterPage, 'The automation center'],
]

const FREE = [
  'app/commissioner-os/workspace/page.tsx',
  'app/commissioner-os/settings/page.tsx',
  'app/commissioner-os/help/page.tsx',
  'app/commissioner-os/notifications/page.tsx',
  'app/commissioner-os/search/page.tsx',
]

beforeEach(() => {
  getDecisionOSAdapter.mockReset()
  getDecisionOSAdapter.mockImplementation(async () => {
    throw new Error('a locked page asked for data')
  })
  resolveCommissionerOsDepth.mockResolvedValue(
    decideCoreDepth('commissioner_depth', { live: true, startsAt: START, hasPlan: false }),
  )
})

describe('Commissioner OS intelligence pages — AF Commissioner', () => {
  it.each(PAID)('%s locks before any data is read', async (_path, Page, what) => {
    render(await Page())
    const lock = screen.getByRole('region', { name: `${what} — AF Commissioner` })
    expect(lock.querySelector('a')?.getAttribute('href')).toBe('/upgrade?plan=commissioner')
    expect(getDecisionOSAdapter).not.toHaveBeenCalled()
  })

  it('[control] open, a page does go on to read its data', async () => {
    resolveCommissionerOsDepth.mockResolvedValue(
      decideCoreDepth('commissioner_depth', { live: true, startsAt: START, hasPlan: true }),
    )
    await expect(LeagueAnalyticsPage()).rejects.toThrow('a locked page asked for data')
    expect(getDecisionOSAdapter).toHaveBeenCalledTimes(1)
  })
})

describe('the run-the-league pages stay free', () => {
  it.each(FREE)('%s does not consult the paywall', (path) => {
    const src = readFileSync(resolve(process.cwd(), path), 'utf8')
    expect(src).not.toContain('commissionerOsDepth')
  })

  it('[control] the scan reads a file that does consult it', () => {
    expect(readFileSync(resolve(process.cwd(), PAID[1]![0]), 'utf8')).toContain('commissionerOsDepth')
  })
})
