import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'app/api/redraft/renewals/[renewalId]/execute/route.ts'), 'utf8')

// Physically verified end-to-end against a disposable Neon branch (real NFL
// and NCAAF proving runs, real unauthorized rejection, real malformed-input
// rejection, real internal-error redaction — see
// docs/redraft/NEXT_SEASON_API_PHYSICAL_VALIDATION.md). This source-contract
// test guards the structural properties that made those real results
// possible, for lasting CI regression coverage without a live database.
describe('POST /api/redraft/renewals/[renewalId]/execute — route contract', () => {
  it('never accepts actorUserId or actorRole from the client request body', () => {
    const bodyParsing = source.slice(source.indexOf('let body:'), source.indexOf('const renewal ='))
    expect(bodyParsing).not.toContain('body.actorUserId')
    expect(bodyParsing).not.toContain('body.actorRole')
  })

  it('derives actor identity from the server session, not the request', () => {
    expect(source).toContain('getServerSession(authOptions')
    expect(source).toContain('session?.user?.id')
  })

  it('derives sourceLeagueId/sourceSeasonId/requestedSeason from the renewal row, never from the client', () => {
    const bodyType = source.slice(source.indexOf('let body:'), source.indexOf('const renewal ='))
    expect(bodyType).not.toMatch(/sourceLeagueId|sourceSeasonId/)
    expect(source).toContain('renewal.leagueId')
    expect(source).toContain('renewal.priorSeasonId')
  })

  it('server-derives authorization via real commissioner membership, not a client-supplied role', () => {
    expect(source).toContain('isCommissioner')
    expect(source).toContain('claimedByUserId === userId')
  })

  it('never returns a raw Prisma/Postgres error to the client', () => {
    const catchBlock = source.slice(source.lastIndexOf('} catch (error)'))
    expect(catchBlock).toContain('console.error')
    expect(catchBlock).not.toMatch(/return NextResponse\.json\(\{[^}]*error\.message/)
    expect(catchBlock).toContain("'INTERNAL_ERROR'")
  })

  it('translates serialization conflicts via the dedicated conflict handler, not a raw retry loop', () => {
    expect(source).toContain('createNextSeasonWithConflictHandling')
    expect(source).toContain("'RETRYABLE_CONFLICT'")
  })

  it('does not return 201 for an already-completed renewal (no false "created" state)', () => {
    const alreadyCompletedBlock = source.slice(source.indexOf('if (renewal.nextSeasonId)'), source.indexOf('const outcome = await createNextSeasonWithConflictHandling'))
    expect(alreadyCompletedBlock).toContain('status: 200')
    expect(alreadyCompletedBlock).not.toContain('status: 201')
  })

  it('maps blocked eligibility to 422 and conflicts to 409, not generic 500s', () => {
    expect(source).toContain("'SOURCE_SEASON_INCOMPLETE', 'Source season is not eligible for renewal.', 422")
    expect(source).toContain("'CONFLICT',")
  })
})
