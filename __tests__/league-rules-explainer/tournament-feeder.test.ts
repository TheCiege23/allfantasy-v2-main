import { beforeEach, describe, expect, it, vi } from 'vitest'
import { feederSettingsSnapshot } from '@/lib/tournament/feederLeagueSettings'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'

const m = vi.hoisted(() => ({
  publish: vi.fn(), update: vi.fn(), settings: { scoring: 'PPR', rosterSize: 15, benchSize: 7 },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'owner' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn() }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  legacyTournament: { findUnique: vi.fn(async () => ({ creatorId: 'owner' })) },
  tournamentShell: { findUnique: vi.fn(async () => null) },
  legacyTournamentLeague: { findFirst: vi.fn(async () => ({ id: 'feeder' })) },
  league: { findUnique: vi.fn(async () => ({ id: 'L', name: 'Feeder', settings: m.settings, teams: [] })), update: m.update },
} }))
import { PATCH } from '@/app/api/tournament/[tournamentId]/feeder-league/settings/route'

beforeEach(() => { vi.clearAllMocks(); m.update.mockResolvedValue({}); m.publish.mockResolvedValue(undefined) })

describe('tournament feeder settings', () => {
  it('renders the saved feeder settings in their own section', () => {
    const snapshot = { sport: 'NFL', format: 'specialty' as const, concept: 'tournament' as const,
      ...feederSettingsSnapshot({ scoring: 'HALF_PPR', rosterSize: 17, benchSize: 8, waiverType: 'FAAB' }) }
    const section = explainLeagueRules(snapshot).find((s) => s.id === 'feeder')
    expect(section?.lines.map((line) => line.id)).toEqual(expect.arrayContaining(['feederScoring', 'feederRosterSize', 'feederBenchSize', 'feederWaiverType']))
  })

  it('publishes the same before and after values that the feeder editor saves', async () => {
    const changes = { rosterSize: 18, benchSize: 9, tradeLockHours: 2 }
    const expected = diffRuleSnapshots(feederSettingsSnapshot(m.settings), feederSettingsSnapshot({ ...m.settings, ...changes }))
    const res = await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ leagueId: 'L', changes }) }), { params: Promise.resolve({ tournamentId: 'T' }) })
    expect(res.status).toBe(200)
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { settings: { ...m.settings, ...changes } } }))
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L', changes: expected }))
    expect(expected.every((change) => explainRuleChange(change, { sport: 'NFL' }))).toBe(true)
  })

  it('sends no rule changes when the editor saves the same settings', async () => {
    const res = await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ leagueId: 'L', changes: { rosterSize: 15 } }) }), { params: Promise.resolve({ tournamentId: 'T' }) })
    expect(res.status).toBe(200)
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ changes: [] }))
  })
})
