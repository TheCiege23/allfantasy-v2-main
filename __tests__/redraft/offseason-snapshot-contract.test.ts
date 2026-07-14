import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const service = fs.readFileSync(path.join(process.cwd(), 'lib/redraft/offseason/RedraftOffseasonService.ts'), 'utf8')
const route = fs.readFileSync(path.join(process.cwd(), 'app/api/redraft/seasons/offseason/route.ts'), 'utf8')
const renewalRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/commissioner/leagues/[leagueId]/renew/route.ts'), 'utf8')

describe('redraft completed-season snapshot and offseason boundary', () => {
  it('requires a completed redraft season and completed league', () => {
    expect(service).toContain("season.status !== 'complete'")
    expect(service).toContain("league.lifecycleState !== 'completed'")
  })

  it('creates the season snapshot once and never updates it', () => {
    expect(service).toContain('leagueSeason.findUnique')
    expect(service).toContain('tx.leagueSeason.create')
    expect(service).not.toContain('leagueSeason.update')
    expect(service).not.toContain('leagueSeason.upsert')
  })

  it.each(['NFL', 'NCAAF'])('uses the same immutable summary contract for %s', () => {
    expect(service).toContain('sport: season.sport')
    expect(service).toContain('franchiseId')
    expect(service).toContain('managerUserId')
    expect(service).toContain('players: roster.players')
  })

  it('enters offseason only through the transaction coordinator', () => {
    expect(service).toContain('transitionLeagueStateInTransaction(tx')
    expect(service).toContain("nextState: 'offseason'")
    expect(service).not.toMatch(/league\.update\([\s\S]{0,220}lifecycleState: 'offseason'/)
  })

  it('writes snapshot and offseason events through the transaction outbox', () => {
    expect(service).toContain('emitInTx(tx, EVENT.SEASON_SNAPSHOT_CREATED')
    expect(service).toContain('emitInTx(tx, EVENT.LEAGUE_ENTERED_OFFSEASON')
    expect(service).toContain("actionType: 'season_snapshot_created'")
  })

  it('publishes one stable member notice after commit', () => {
    expect(service).toContain('publishLeagueFanoutEvent')
    expect(service).toContain('dedupeKey: `offseason-enter:${seasonId}`')
  })

  it('prevents the legacy renewal route from rewriting an existing snapshot', () => {
    expect(renewalRoute).toContain('leagueSeason.findUnique')
    expect(renewalRoute).toContain('if (!existingSnapshot)')
    expect(renewalRoute).not.toContain('leagueSeason.upsert')
    expect(renewalRoute).not.toContain('leagueSeason.update')
  })
  it('requires commissioner authority at the route boundary', () => {
    expect(route).toContain('Unauthorized')
    expect(route).toContain('Forbidden - commissioner only')
    expect(route).toContain('isCoCommissioner')
  })
})