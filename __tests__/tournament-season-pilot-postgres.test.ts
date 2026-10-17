/** Explicit isolated-Neon pilot only. The launcher verifies the target before setting this opt-in. */
import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { completeConfig } from './helpers/seasonTournamentFixture'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'
import { openSeasonRegistration, joinSeasonTournament, freezeSeasonOpeningField, loadSeasonRegistration } from '@/lib/tournament/seasonRegistration'
import { provisionNextSeasonLeague, loadSeasonNativeSetup } from '@/lib/tournament/seasonNativeProvisioning'

const pilot = process.env.TOURNAMENT_PILOT_DB === '1' ? describe : describe.skip
pilot('64-entry NBA opening field on isolated Postgres', () => {
  it('admits 64 synthetic managers, freezes the field, and provisions eight blocked drafts', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toMatch(/^ep-billowing-dream-b7cf9pxk-pooler\.c-13\.us-east-1\.aws\.neon\.tech$/)
    expect(target.pathname).toBe('/tournament_pilot')
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`
    expect(identity[0]?.database).toBe('tournament_pilot')

    const ownerId = 'pilot-commissioner'
    const tournamentId = 'nba-pilot-64-staging'
    const config = completeConfig()
    const hash = seasonContractHash({ config, calendarDigest: 'synthetic-staging-only', acceptExcludedGames: false, acceptPendingGames: false })
    await prisma.tenant.upsert({ where: { id: 'tournament-pilot' }, update: {}, create: { id: 'tournament-pilot', slug: 'tournament-pilot', name: 'Tournament Pilot' } })
    await prisma.appUser.createMany({
      data: [ownerId, ...Array.from({ length: 64 }, (_, i) => `pilot-entrant-${String(i + 1).padStart(2, '0')}`)].map(id => ({ id, email: `${id}@example.invalid`, username: id, displayName: id })),
      skipDuplicates: true,
    })
    await prisma.tournamentShell.upsert({
      where: { id: tournamentId }, update: {},
      create: { id: tournamentId, name: 'NBA Pilot Synthetic Validation', sport: 'NBA', status: 'rules_published', maxParticipants: 64, openingWeekStart: 1, commissionerId: ownerId, createdBy: ownerId },
    })
    let publication = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_rules_published' } })
    publication ??= await prisma.tournamentAuditLog.create({ data: {
      tournamentId, action: 'season_rules_published', actorType: 'commissioner', actorId: ownerId,
      targetType: 'tournament', targetId: tournamentId,
      data: { version: 1, sourceRevision: 'synthetic-staging', config, hash, calendar: { digest: 'synthetic-staging-only', checkedAt: new Date().toISOString(), regularGames: 0, pendingGames: 0, excludedGames: [] }, acceptExcludedGames: false, acceptPendingGames: false },
    } })
    const priorFreeze = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_opening_field_frozen' } })
    if (!priorFreeze) {
      const invite = await openSeasonRegistration(ownerId, tournamentId, publication.id, '2026-10-17T18:00:00.000Z', 0)
      const token = new URL(invite.invitePath, 'https://example.invalid').searchParams.get('invite')!
      expect(token).toMatch(/^[a-f0-9]{64}$/)
      for (let i = 1; i <= 64; i++) {
        const id = `pilot-entrant-${String(i).padStart(2, '0')}`
        const entry = await joinSeasonTournament(id, tournamentId, token, publication.id, hash)
        expect(entry.status).toBe('registered')
      }
    }
    const board = await loadSeasonRegistration(ownerId, tournamentId)
    expect(board).toMatchObject({ capacity: 64, registered: 64, waitlisted: 0, fullField: true })
    const frozen = await freezeSeasonOpeningField(ownerId, tournamentId, publication.id)
    let created = await prisma.tournamentLeague.count({ where: { tournamentId } })
    while (created < 8) {
      const result = await provisionNextSeasonLeague(ownerId, tournamentId, frozen.freezeId)
      created++
      expect(result).toMatchObject({ created: true, completed: created, total: 8, launchReady: false })
    }
    expect(await provisionNextSeasonLeague(ownerId, tournamentId, frozen.freezeId)).toMatchObject({ complete: true, created: false, completed: 8, total: 8, launchReady: false })
    const setup = await loadSeasonNativeSetup(ownerId, tournamentId)
    expect(setup?.leagues).toHaveLength(8)
    expect(setup?.leagues.every(league => league.state === 'created')).toBe(true)
    const leagues = await prisma.tournamentLeague.findMany({ where: { tournamentId } })
    expect(leagues).toHaveLength(8)
    for (const league of leagues) {
      expect(await prisma.tournamentLeagueParticipant.count({ where: { tournamentLeagueId: league.id } })).toBe(8)
      const native = await prisma.league.findUnique({ where: { id: league.leagueId! } })
      const draft = await prisma.draftSession.findUnique({ where: { id: league.draftSessionId! } })
      expect(native).toMatchObject({ tenantId: 'tournament-pilot', locked: true })
      expect(draft).toMatchObject({ status: 'tournament_setup_blocked', teamCount: 8, sportType: 'NBA' })
    }
  }, 300_000)
})
