/** Real Postgres draft mechanics with an isolated pilot DB and synthetic schedule/ranks. */
import { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { completeConfig } from './helpers/seasonTournamentFixture'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'
import { readOpeningManifest } from '@/lib/tournament/seasonNativeContract'
import { openSeasonRegistration, joinSeasonTournament, freezeSeasonOpeningField } from '@/lib/tournament/seasonRegistration'
import { provisionNextSeasonLeague, loadSeasonNativeSetup } from '@/lib/tournament/seasonNativeProvisioning'
import { readSeasonDraftSnapshot } from '@/lib/tournament/seasonDraftRuntime'
import { assessSeasonDraftPool, selectSeasonAutodraft } from '@/lib/tournament/seasonDraftPolicy'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'

const schedule = vi.hoisted(() => ({ contract: vi.fn(), review: vi.fn() }))
vi.mock('@/lib/tournament/seasonScheduleReview', () => ({
  loadPublishedScheduleContract: schedule.contract,
  reviewSeasonPublishedSchedule: schedule.review,
}))

const pilot = process.env.TOURNAMENT_PILOT_DB === '1' ? describe : describe.skip
const DAY = 24 * 60 * 60_000
const OWNER = 'pilot-commissioner'
const TOURNAMENT = 'nba-pilot-draft-postgres'
const TENANT = 'tournament-pilot'

function futureSyntheticConfig() {
  const config = completeConfig()
  config.name = 'NBA Pilot Synthetic Draft Rehearsal'
  const calendar = config.rules!.calendar
  // Keep this isolated fixture runnable after the real October draft window.
  const days = Math.max(0, Math.ceil((Date.now() + 4 * DAY - Date.parse(calendar.regularSeasonStartsAt)) / DAY))
  const move = (date: string) => new Date(Date.parse(date) + days * DAY).toISOString()
  calendar.regularSeasonStartsAt = move(calendar.regularSeasonStartsAt)
  calendar.regularSeasonEndsAt = move(calendar.regularSeasonEndsAt)
  calendar.periods = calendar.periods.map(period => ({ ...period, startsAt: move(period.startsAt), endsAt: move(period.endsAt), finalizesAt: move(period.finalizesAt) }))
  calendar.drafts = calendar.drafts.map(draft => ({ ...draft, startsAt: move(draft.startsAt), completeBy: move(draft.completeBy) }))
  calendar.seasonLabel = 'Isolated synthetic rehearsal'
  return config
}

pilot('eight-manager NBA draft on isolated Postgres', () => {
  it('releases one audited draft, makes 96 picks, resumes controls, and prepares locked rosters', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toBe('ep-billowing-dream-b7cf9pxk-pooler.c-13.us-east-1.aws.neon.tech')
    expect(target.pathname).toBe('/tournament_pilot')
    expect((await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`)[0]?.database).toBe('tournament_pilot')

    await prisma.tenant.upsert({ where: { id: TENANT }, update: {}, create: { id: TENANT, slug: TENANT, name: 'Tournament Pilot' } })
    await prisma.appUser.createMany({
      data: [OWNER, ...Array.from({ length: 64 }, (_, i) => `pilot-entrant-${String(i + 1).padStart(2, '0')}`)].map(id => ({ id, email: `${id}@example.invalid`, username: id, displayName: id })),
      skipDuplicates: true,
    })
    await prisma.tournamentShell.upsert({
      where: { id: TOURNAMENT }, update: {},
      create: { id: TOURNAMENT, name: 'NBA Pilot Synthetic Draft Rehearsal', sport: 'NBA', status: 'rules_published', maxParticipants: 64, openingWeekStart: 1, commissionerId: OWNER, createdBy: OWNER },
    })

    let publication = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId: TOURNAMENT, action: 'season_rules_published' } })
    if (!publication) {
      const config = futureSyntheticConfig()
      const calendarDigest = 'synthetic-postgres-draft-only'
      publication = await prisma.tournamentAuditLog.create({ data: {
        tournamentId: TOURNAMENT, action: 'season_rules_published', actorType: 'commissioner', actorId: OWNER,
        targetType: 'tournament', targetId: TOURNAMENT,
        data: { version: 1, sourceRevision: 'synthetic-postgres-draft', config,
          hash: seasonContractHash({ config, calendarDigest, acceptExcludedGames: false, acceptPendingGames: false }),
          calendar: { digest: calendarDigest, checkedAt: new Date().toISOString(), regularGames: 0, pendingGames: 0, excludedGames: [] },
          acceptExcludedGames: false, acceptPendingGames: false },
      } })
    }
    const published = publication.data as { config: ReturnType<typeof completeConfig>; hash: string }
    let frozen = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId: TOURNAMENT, action: 'season_opening_field_frozen' } })
    if (!frozen) {
      const closesAt = new Date(Math.min(Date.now() + DAY, Date.parse(published.config.rules!.calendar.drafts[0]!.startsAt) - 60 * 60_000)).toISOString()
      const invite = await openSeasonRegistration(OWNER, TOURNAMENT, publication.id, closesAt, 0)
      const token = new URL(invite.invitePath, 'https://example.invalid').searchParams.get('invite')!
      for (let i = 1; i <= 64; i++) {
        const entrant = `pilot-entrant-${String(i).padStart(2, '0')}`
        expect((await joinSeasonTournament(entrant, TOURNAMENT, token, publication.id, published.hash)).status).toBe('registered')
      }
      const result = await freezeSeasonOpeningField(OWNER, TOURNAMENT, publication.id)
      frozen = await prisma.tournamentAuditLog.findUniqueOrThrow({ where: { id: result.freezeId } })
    }
    const manifest = readOpeningManifest(frozen.data)
    while (await prisma.tournamentLeague.count({ where: { tournamentId: TOURNAMENT } }) < 8) {
      await provisionNextSeasonLeague(OWNER, TOURNAMENT, frozen.id)
    }
    const setup = await loadSeasonNativeSetup(OWNER, TOURNAMENT)
    expect(setup?.leagues).toHaveLength(8)
    const selected = setup!.leagues[0]!
    const leagueId = selected.leagueId!
    const assignment = await prisma.tournamentLeague.findFirstOrThrow({ where: { tournamentId: TOURNAMENT, leagueId } })
    const draftId = assignment.draftSessionId!

    const catalog = await prisma.sportsPlayer.findMany({
      where: { sport: 'NBA', source: 'rolling_insights' },
      select: { externalId: true, name: true, position: true, team: true }, orderBy: { externalId: 'asc' },
    })
    expect(catalog).toHaveLength(499)
    const players = catalog.map((row, index) => ({
      playerId: row.externalId, playerName: row.name, position: row.position!, team: row.team,
      rank: index + 1, adp: null,
      draftIdProvenance: { namespace: 'rolling_insights' as const, sourceRecordId: row.externalId },
    }))
    const assessment = assessSeasonDraftPool(manifest.config, players, 8)
    expect(assessment).toMatchObject({ ready: true, required: 96, blockers: [] })
    const previous = await readSeasonDraftSnapshot(leagueId, manifest.manifestHash)
    if (!previous || Date.parse(previous.expiresAt) < Date.now() + 30 * 60_000) {
      await prisma.tournamentAuditLog.create({ data: {
        tournamentId: TOURNAMENT, actorId: OWNER, actorType: 'user', action: 'season_draft_pool_checked',
        targetType: 'league', targetId: leagueId,
        data: { version: 1, manifestHash: manifest.manifestHash, ready: true, checkedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(), players,
          required: assessment.required, matched: assessment.matched, blockers: [], source: 'isolated_catalog_synthetic_rank', launchReady: false },
      } })
    }

    schedule.contract.mockResolvedValue({ manifest, calendar: { provider: 'rolling_insights', ready: true, regularGames: 1200, pendingGames: 0, excludedGames: [] } })
    schedule.review.mockResolvedValue({ currentCoverageReady: true, changes: [], checkedAt: new Date().toISOString(), pendingGames: 0 })
    const originalFlag = process.env.TOURNAMENT_DRAFT_RELEASE_ENABLED
    process.env.TOURNAMENT_DRAFT_RELEASE_ENABLED = 'true'
    try {
      const { releaseSeasonOpeningDraft } = await import('@/lib/tournament/seasonDraftRelease')
      const { startDraftSession, pauseDraftSession, resumeDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
      const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
      const { submitBestAvailableAutopickForExpiredTimer } = await import('@/lib/live-draft-engine/autopickBestAvailableSubmit')
      const { prepareSeasonOpeningRosters } = await import('@/lib/tournament/seasonRosterPreparation')

      let session = await prisma.draftSession.findUniqueOrThrow({ where: { id: draftId } })
      if (session.status === 'tournament_setup_blocked') {
        expect(await startDraftSession(leagueId)).toMatchObject({ ok: false, reason: 'session_not_ready' })
        expect(await releaseSeasonOpeningDraft(OWNER, TOURNAMENT, frozen.id, selected.key)).toMatchObject({ released: true, repeated: false, seasonLaunchReady: false })
        session = await prisma.draftSession.findUniqueOrThrow({ where: { id: draftId } })
      }
      if (session.status === 'pre_draft') expect(await startDraftSession(leagueId)).toMatchObject({ ok: true })
      if (session.status === 'paused') expect(await resumeDraftSession(leagueId)).toBe(true)

      for (;;) {
        const live = await prisma.draftSession.findUniqueOrThrow({ where: { id: draftId }, include: { picks: { orderBy: { overall: 'asc' } } } })
        if (live.picks.length >= 96) break
        expect(live.status).toBe('in_progress')
        const order = live.slotOrder as Array<{ slot: number; rosterId: string; displayName: string }>
        const current = resolveCurrentOnTheClock({ totalPicks: 96, picks: live.picks, teamCount: 8, draftType: 'snake', thirdRoundReversal: false, slotOrder: order })!
        if (live.picks.length === 0) {
          expect(await submitBestAvailableAutopickForExpiredTimer(leagueId, current.rosterId, current.overall)).toMatchObject({ ok: true })
        } else {
          const own = live.picks.filter(p => p.rosterId === current.rosterId).map(p => ({ playerId: p.playerId ?? '', playerName: p.playerName, position: p.position }))
          const candidate = selectSeasonAutodraft(manifest.config, own, players, new Set(live.picks.map(p => p.playerId ?? '')))
          expect(candidate).not.toBeNull()
          expect(await submitPick({ leagueId, ...candidate!, rosterId: current.rosterId, source: 'user', expectedOverall: current.overall })).toMatchObject({ success: true })
        }
        if (live.picks.length === 15) {
          expect(await pauseDraftSession(leagueId, OWNER)).toBe(true)
          expect((await prisma.draftSession.findUniqueOrThrow({ where: { id: draftId } })).status).toBe('paused')
          expect(await resumeDraftSession(leagueId)).toBe(true)
        }
        if (live.picks.length === 23) {
          const reconnected = new PrismaClient()
          try {
            expect(await reconnected.draftPick.count({ where: { sessionId: draftId } })).toBe(24)
          } finally { await reconnected.$disconnect() }
        }
      }

      const completed = await prisma.draftSession.findUniqueOrThrow({ where: { id: draftId }, include: { picks: true } })
      expect(completed).toMatchObject({ status: 'completed', teamCount: 8, rounds: 12 })
      expect(completed.picks).toHaveLength(96)
      expect(new Set(completed.picks.map(p => p.playerId)).size).toBe(96)
      expect(await prisma.tournamentAuditLog.count({ where: { tournamentId: TOURNAMENT, action: 'season_opening_draft_released', targetId: leagueId } })).toBe(1)
      expect(await prisma.tournamentAuditLog.count({ where: { tournamentId: TOURNAMENT, action: 'season_draft_board_completed', targetId: leagueId } })).toBe(1)
      expect(await prepareSeasonOpeningRosters(OWNER, TOURNAMENT, frozen.id, selected.key)).toMatchObject({ prepared: true, teams: 8, launchReady: false })
      expect((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).locked).toBe(true)
      expect((await prisma.leagueWaiverState.findUniqueOrThrow({ where: { leagueId } })).processingLocked).toBe(true)
      process.stdout.write(JSON.stringify({ target: 'isolated_nba_pilot', league: selected.key, picks: completed.picks.length, teams: 8, seasonLaunchReady: false }) + '\n')
    } finally {
      if (originalFlag === undefined) delete process.env.TOURNAMENT_DRAFT_RELEASE_ENABLED
      else process.env.TOURNAMENT_DRAFT_RELEASE_ENABLED = originalFlag
    }
  }, 1_500_000)
})
