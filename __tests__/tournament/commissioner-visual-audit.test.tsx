import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeSettingsPatch, roundPhaseLabel, tournamentStatusLabel } from '@/lib/tournament/commissionerLabels'
import { translations } from '@/lib/i18n/translations'
import { TournamentApprovalsCenter } from '@/components/tournament/TournamentApprovalsCenter'
import { TournamentHistoryArchivePanel } from '@/components/tournament/TournamentHistoryArchivePanel'
import { approvals, summary } from '@/app/e2e/tournament/commissioner-fixtures'
import fs from 'node:fs'
import path from 'node:path'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('tournament commissioner dashboard — visual audit', () => {
  it('turns engine codes into words', () => {
    expect(tournamentStatusLabel('in_progress')).toBe('In progress')
    expect(tournamentStatusLabel('pre_draft')).toBe('Before the draft')
    expect(tournamentStatusLabel('some_new_state')).toBe('Some new state')
    expect(roundPhaseLabel('finals')).toBe('Finals')
    expect(describeSettingsPatch({ waiverType: 'rolling', tradeDeadlineWeek: 7, scoring: { passTd: 6 }, ir: true })).toEqual([
      { setting: 'Waiver type', value: 'Rolling' },
      { setting: 'Trade deadline week', value: '7' },
      { setting: 'Scoring · Pass td', value: '6' },
      { setting: 'Ir', value: 'On' },
    ])
  })

  it('shows a proposed settings change as rows, not a JSON dump', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => approvals })))
    const { container } = render(<TournamentApprovalsCenter tournamentId="e2e-tournament" />)
    await waitFor(() => expect(screen.getByTestId('tournament-approval-changes-req-1')).toBeTruthy())
    const rows = [...screen.getByTestId('tournament-approval-changes-req-1').querySelectorAll('div')].map(d => d.textContent)
    expect(rows).toEqual(['Waiver typeRolling', 'Trade deadline week7'])
    expect(container.querySelector('pre')).toBeNull()
    expect(container.textContent).not.toMatch(/league\.settings|tradeDeadlineWeek|[{}]/)
  })

  it('names round phases and the tournament status in history', () => {
    const { container } = render(<TournamentHistoryArchivePanel rounds={summary.rounds} tournamentStatus="in_progress" />)
    const text = container.textContent ?? ''
    expect(text).toContain('Tournament status: In progress')
    expect(text).not.toMatch(/in_progress|audit streams|wire to tournament events/)
    // The final round has no name in the fixture: its phase stands in, in words.
    expect([...container.querySelectorAll('li p.font-semibold')].map(p => p.textContent)).toEqual(['Opening Round', 'Elite Eight', 'Finals'])
  })

  it('keeps implementation details out of commissioner copy, in both languages', () => {
    const keys = [
      'tournament.commissioner.draftsPanelSubtitle', 'tournament.commissioner.approvalsSubtitle',
      'tournament.commissioner.standings.subtitle', 'tournament.commissioner.members.miniBody',
    ]
    for (const lang of ['en', 'es'] as const) {
      for (const key of keys) {
        const value = (translations as Record<string, Record<string, string>>)[lang]![key]
        expect(value, `${lang} ${key}`).toBeTruthy()
        expect(value, `${lang} ${key}`).not.toMatch(/draftScheduleV1|league\.settings|\/api\/|payload|endpoint|API\b/)
      }
    }
    expect(read('components/tournament/TournamentAiOperationsCenter.tsx')).not.toMatch(/job runners|server-side/)
  })

  it('keeps the dashboard free of raw status codes and waitlist user ids', () => {
    const src = read('components/tournament/TournamentCommissionerDashboard.tsx')
    expect(src).not.toMatch(/>\{summary\.tournament\.status\}<|value=\{summary\.tournament\.status\}/)
    expect(src).not.toMatch(/row\.userId\.slice/)
    expect(src).toMatch(/label: r\.name \?\? roundPhaseLabel\(r\.phase\)/)
    // Invite cards: the league name holds a 14rem basis so the buttons wrap below it on a phone.
    expect(read('components/tournament/TournamentControlDashboard.tsx')).toMatch(/^\s*<div className="min-w-0 flex-1 basis-56">/m)
  })
})
