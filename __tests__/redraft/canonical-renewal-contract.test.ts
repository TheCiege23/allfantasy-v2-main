import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const service = fs.readFileSync(path.join(process.cwd(), 'lib/redraft/renewal/CanonicalRedraftRenewalService.ts'), 'utf8')
const legacy = fs.readFileSync(path.join(process.cwd(), 'app/api/commissioner/leagues/[leagueId]/renew/route.ts'), 'utf8')
describe('canonical redraft renewal contract', () => {
  it('requires offseason and an immutable summary', () => { expect(service).toContain("lifecycleState !== 'offseason'"); expect(service).toContain('SNAPSHOT_REQUIRED') })
  it('creates one renewal per league season and one slot per current manager', () => { expect(service).toContain('leagueId_season'); expect(service).toContain('leagueRenewalSlot.createMany') })
  it.each(['NFL', 'NCAAF'])('uses the same renewal persistence for %s', () => { expect(service).toContain("renewalKind: 'redraft_reset'") })
  it('moves lifecycle through the coordinator and writes the outbox transactionally', () => { expect(service).toContain('transitionLeagueStateInTransaction(tx'); expect(service).toContain('emitInTx(tx, EVENT.RENEWAL_OPENED') })
  it('limits decisions to the authenticated manager slot', () => { expect(service).toContain('renewalId_userId'); expect(service).toContain('RENEWAL_LOCKED') })
  it('makes repeated decisions stable', () => { expect(service).toContain('if (slot.status === status)') })
  it('deprecates the legacy competing POST engine', () => { const post=legacy.slice(legacy.indexOf('export async function POST')); expect(post).toContain('status: 410'); expect(post).toContain('/api/redraft/renewals') })
})