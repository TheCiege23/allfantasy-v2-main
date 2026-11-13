import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildSeasonBlueprint, defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { answerSeasonAssistant, loadSeasonAssistantContext } from '@/lib/tournament/seasonAssistantContext'

const { prisma, loadBlueprint, loadEntry, loadDraft, getSession, commandCenterSnapshot } = vi.hoisted(() => ({
  getSession: vi.fn(),
  commandCenterSnapshot: vi.fn(),
  prisma: {
    tournamentAuditLog: { findFirst: vi.fn() },
    tournamentShellGrant: { findUnique: vi.fn() },
    tournamentParticipant: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
  loadBlueprint: vi.fn(),
  loadEntry: vi.fn(),
  loadDraft: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({ getDashboardLeagueListForUser: vi.fn() }))
vi.mock('@/lib/sports-evidence/intelligenceIntegration', () => ({ CertifiedIntelligenceIntegrationService: vi.fn() }))
vi.mock('@/lib/decision-os/managerCommandCenter', () => ({ resolveManagerCommandCenterSnapshot: commandCenterSnapshot }))
vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/core-app/careerDecisionInput', () => ({ loadCareerDecisionInput: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/survivor/survivorFormatSignals', () => ({ loadSurvivorFormatSignals: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/tournament/seasonBlueprintStore', () => ({ loadSeasonBlueprint: loadBlueprint }))
vi.mock('@/lib/tournament/seasonRegistration', () => ({ loadSeasonEntry: loadEntry }))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: loadDraft }))
vi.mock('@/lib/tournament/seasonReportPublication', () => ({ SEASON_REPORT_PUBLISHED: 'season_standings_report_published' }))

const startsAt = '2026-10-25T16:00:00.000Z'
const completeBy = '2026-10-25T18:00:00.000Z'
const publication = { id: 'published-rules', hash: 'frozen-rules-hash' }
const configFor = (sport: 'NFL' | 'NBA') => {
  const config = defaultSeasonBlueprint(sport)
  const rules = defaultSeasonRules(sport, config.scoring)
  rules.calendar.periods = [{ number: 1, startsAt: completeBy, endsAt: '2026-10-29T18:00:00.000Z', finalizesAt: '2026-10-30T18:00:00.000Z' }]
  return { ...config, name: sport + ' Autumn Tournament', rules }
}

const league = { id: 'our-room', key: 'stage-1-league-1', name: 'North League', division: 'North' }
const own = { entrantId: 'entrant', leagueId: league.id, manager: 'Our Manager', standing: 'Bubble', leagueRank: 3, pointsFor: 72.5 }
const other = { entrantId: 'private-entrant', leagueId: 'other-room', manager: 'Other Manager', standing: 'Champion' }
let report: { stage: number; period: number; status: string; official: boolean; manifestHash: string }

function mockEntry(sport: 'NFL' | 'NBA') {
  loadEntry.mockResolvedValue({
    config: configFor(sport),
    publicationId: publication.id,
    hash: publication.hash,
    status: 'registered',
    participantId: own.entrantId,
    assignment: { name: league.name, leagueId: league.id, stage: 1, draftSlot: 4, startsAt, completeBy },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  report = { stage: 1, period: 1, status: 'corrected', official: false, manifestHash: 'frozen-manifest' }
  prisma.tournamentAuditLog.findFirst.mockImplementation(async ({ where }) => where.action === 'season_blueprint_created'
    ? { tournament: { commissionerId: 'owner' } }
    : {
      id: 'report-v2', createdAt: new Date(completeBy),
      data: {
        ...report, schemaVersion: 1, revision: 2, leagues: [league, { id: 'other-room', name: 'Other League' }], rows: [own, other],
      },
    })
  prisma.$queryRaw.mockImplementation(async () => [{ id: 'report-v2', ...report, revision: 2, publishedAt: new Date(completeBy) }])
  prisma.tournamentParticipant.findFirst.mockImplementation(async ({ where }) => where.userId === 'manager'
    ? { id: own.entrantId, leagueParticipations: [{ league: { round: { roundNumber: 1 } } }] } : null)
  loadBlueprint.mockResolvedValue({ ...buildSeasonBlueprint(configFor('NFL')), publication, currentStage: 1 })
  mockEntry('NBA')
})

describe('read-only tournament guidance', () => {
  it('keeps unregistered users out before reading rules, draft rooms or reports', async () => {
    await expect(loadSeasonAssistantContext('native', 'outsider', league.id)).resolves.toBeNull()
    expect(loadEntry).not.toHaveBeenCalled()
    expect(loadBlueprint).not.toHaveBeenCalled()
    expect(loadDraft).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('uses the frozen NBA scoring, roster and prorated starts for a manager', async () => {
    const context = (await loadSeasonAssistantContext('native', 'manager'))!
    expect(context.publication).toMatchObject(publication)
    expect(context.rules.nbaStarts).toEqual([{ period: 1, cap: 22 }])
    expect(answerSeasonAssistant(context, 'rules')).toContain('1 PG')
    expect(answerSeasonAssistant(context, 'rules')).toContain('1 (22)')
    expect(answerSeasonAssistant(context, 'draft')).toContain('North League · Draft slot 4')
    expect(context.draft.assignment?.href).toBe('/league/our-room/draft')
  })

  it('limits manager standings to their own league and preserves the correction status', async () => {
    const context = (await loadSeasonAssistantContext('native', 'manager'))!
    expect(context.standings).toMatchObject({
      id: 'report-v2', summary: '1 bubble', own: { standing: 'Bubble', leagueRank: 3, pointsFor: 72.5 },
    })
    expect(context.standings?.href).toContain('reportId=report-v2')
    expect(JSON.stringify(context)).not.toContain('private-entrant')
    expect(answerSeasonAssistant(context, 'standings')).toContain('Corrected provisional standings')
    report.official = true
    const updated = (await loadSeasonAssistantContext('native', 'manager'))!
    expect(answerSeasonAssistant(updated, 'standings')).toContain('Corrected official standings')
  })

  it('gives staff stage counts and uses the published NFL rules', async () => {
    const context = (await loadSeasonAssistantContext('native', 'owner'))!
    expect(context.standings?.summary).toBe('1 bubble · 1 champion')
    expect(context.standings?.own).toBeNull()
    expect(context.rules.nbaStarts).toBeNull()
    expect(answerSeasonAssistant(context, 'rules')).toContain('1 QB')
    expect(answerSeasonAssistant(context, 'rules')).not.toContain('NBA')
  })

  it('grounds an earlier draft room in its frozen stage and rejects mismatched scopes', async () => {
    loadBlueprint.mockResolvedValue({ ...buildSeasonBlueprint(configFor('NFL')), publication, currentStage: 3 })
    loadDraft.mockResolvedValue({
      tournamentId: 'native', publicationId: publication.id, rulesHash: publication.hash,
      manifestHash: 'frozen-manifest', stage: 1, config: configFor('NFL'),
      pool: { name: league.name, members: [{ id: own.entrantId, userId: 'manager', draftSlot: 4 }] },
      draftWindow: { stage: 1, startsAt, completeBy },
    })
    const room = (await loadSeasonAssistantContext('native', 'owner', league.id))!
    expect(room.stage.number).toBe(1)
    expect(room.draft.room?.manifestHash).toBe('frozen-manifest')
    expect(room.standings?.scope).toBe('league')
    expect(room.standings?.summary).toBe('1 bubble')
    expect(room.standings?.href).toContain('leagueId=our-room')

    await expect(loadSeasonAssistantContext('different-tournament', 'manager', league.id)).resolves.toBeNull()
    report.manifestHash = 'another-manifest'
    expect((await loadSeasonAssistantContext('native', 'manager', league.id))?.standings).toBeNull()

    loadDraft.mockResolvedValue({ tournamentId: 'native', pool: { members: [{ id: 'another-entrant', userId: 'another-manager' }] } })
    await expect(loadSeasonAssistantContext('native', 'manager', 'other-room')).resolves.toBeNull()
  })

  it('serves scoped Manager OS facts to the authenticated viewer through the command center route', async () => {
    const { GET } = await import('@/app/api/decision-os/manager-command-center/route')
    const request = new NextRequest('http://localhost/api/decision-os/manager-command-center?tournamentId=native&userId=owner')
    getSession.mockResolvedValueOnce({ user: { id: 'manager' } })
    const response = await GET(request)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      tournament: { sport: 'NBA', scope: 'entrant', standings: { id: 'report-v2', summary: '1 bubble' }, publication },
    })
    expect(commandCenterSnapshot).not.toHaveBeenCalled()

    getSession.mockResolvedValueOnce({ user: { id: 'outsider' } })
    expect((await GET(request)).status).toBe(404)
    expect((await GET(request)).status).toBe(401)
  })

  it('leaves standings empty when a stage has no authorized published report', async () => {
    prisma.$queryRaw.mockResolvedValue([])
    const context = (await loadSeasonAssistantContext('native', 'manager'))!
    expect(context.standings).toBeNull()
    expect(answerSeasonAssistant(context, 'standings')).toContain('No standings report is available')
  })
})
