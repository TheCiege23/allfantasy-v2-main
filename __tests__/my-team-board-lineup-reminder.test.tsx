import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import type { ProactiveUserSettings } from '@/lib/chimmy-alerts/proactiveDelivery'
import { getLineupReminderStatus, lineupReminderStateOf, type LineupReminderStatus } from '@/lib/core-app/lineupReminderStatus'
import type { MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'
import { MyTeamBoard } from '@/components/core-app/MyTeamBoard'

afterEach(cleanup)

const settings = (enabled: boolean, chimmy: ProactiveUserSettings['chimmy'] = null): ProactiveUserSettings => ({
  notifications: { globalEnabled: true, categories: { lineup_reminders: { enabled } } } as unknown as ProactiveUserSettings['notifications'],
  chimmy,
})

describe('lineupReminderStateOf — the sender’s own gates', () => {
  it('reads on, off, and muted in Chimmy’s controls', () => {
    expect(lineupReminderStateOf(settings(true))).toBe('on')
    expect(lineupReminderStateOf(settings(false))).toBe('off')
    expect(lineupReminderStateOf(settings(true, { mutedClasses: ['lineup'] } as never))).toBe('muted')
    expect(lineupReminderStateOf(settings(true, { typeOverrides: { lineup_check: { muted: true } } } as never))).toBe('muted')
  })

  it('is off when notifications are off globally, whatever the category says', () => {
    const s = settings(true)
    ;(s.notifications as { globalEnabled: boolean }).globalEnabled = false
    expect(lineupReminderStateOf(s)).toBe('off')
  })

  it('takes its window from the sender’s constants, and says nothing without a profile', async () => {
    expect(await getLineupReminderStatus('u', async () => settings(true))).toEqual({ state: 'on', opensHoursBefore: 4, closesHoursBefore: 1 })
    expect(await getLineupReminderStatus('u', async () => null)).toBeNull()
  })
})

const row = (id: string, sport: string): MyTeamRow => ({
  leagueId: id, leagueName: `League ${id}`, platform: 'sleeper', logoUrl: null, leagueBadge: 'LG', teamName: 'Mine',
  starters: 9, empty: 0, out: 0, bye: 0, questionable: 0, unresolved: 0, lockAt: null, locked: false,
  season: 2026, week: 5, severity: 0, href: `/core/my-team?league=${id}`, platformLeagueId: null, leagueSeason: 2026, teamId: '4', sport,
})
const pulse = (rows: MyTeamRow[]): MyTeamPulse => ({
  needs: [], set: rows, needsTotal: 0, setTotal: rows.length, considered: rows.length, checked: rows.length,
  byeChecked: true, notChecked: { noRoster: 0, noLineup: 0 },
})
const status = (state: LineupReminderStatus['state']): LineupReminderStatus => ({ state, opensHoursBefore: 4, closesHoursBefore: 1 })
const line = (p: MyTeamPulse, s: LineupReminderStatus | null) =>
  render(<MyTeamBoard pulse={p} now={Date.parse('2026-10-03T12:00:00Z')} allHref="/core/my-team?all=1" lineupReminder={s} />)
    .container.querySelector('.af-bd-note--reminder')

describe('the board line', () => {
  it('says when the check fires, and links to the setting', () => {
    const el = line(pulse([row('A', 'NFL')]), status('on'))!
    expect(el.textContent).toBe('Lineup reminder is on: once a week, 1–4 hours before the main NFL slate, Chimmy checks every lineup and messages you only if one needs fixing. Manage')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/settings?tab=notifications&returnTo=%2Fcore%2Fmy-team')
  })

  it('offers to turn it on when off, and says plainly when Chimmy’s lineup alerts are muted', () => {
    expect(line(pulse([row('A', 'NFL')]), status('off'))?.textContent).toMatch(/^Lineup reminder is off\. .*Turn it on$/)
    expect(line(pulse([row('A', 'NFL')]), status('muted'))?.textContent).toContain('nothing will check these lineups for you before kickoff')
  })

  it('is omitted with no NFL lineup in view — the check reads NFL only — and with no status', () => {
    expect(line(pulse([row('A', 'NBA')]), status('on'))).toBeNull()
    expect(line(pulse([row('A', 'NFL')]), null)).toBeNull()
  })
})
