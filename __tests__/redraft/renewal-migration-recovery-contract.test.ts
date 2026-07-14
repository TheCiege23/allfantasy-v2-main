import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const stage1 = fs.readFileSync(path.join(root, 'prisma/migrations/20260711120000_create_redraft_renewal_foundation/migration.sql'), 'utf8')
const stage2 = fs.readFileSync(path.join(root, 'prisma/migrations/20260711121000_extend_redraft_renewal_for_franchises/migration.sql'), 'utf8')
const runtime = fs.readFileSync(path.join(root, 'lib/redraft/renewal/CanonicalRedraftRenewalService.ts'), 'utf8')

describe('redraft renewal migration recovery contract', () => {
  it('materializes the current renewal foundation separately', () => {
    expect(stage1).toContain('CREATE TABLE "league_renewals"')
    expect(stage1).toContain('CREATE TABLE "league_renewal_slots"')
    expect(stage1).toContain('league_renewals_leagueId_season_key')
    expect(stage1).toContain('league_renewal_slots_renewalId_userId_key')
    expect(stage1).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i)
  })

  it('adds franchise persistence without removing manager compatibility', () => {
    for (const field of ['franchiseId', 'priorManagerId', 'candidateManagerId', 'confirmedManagerId', 'confirmedAt', 'confirmedByUserId', 'replacementInvitationId', 'decisionAt', 'removedFromNextSeason']) expect(stage2).toContain(`"${field}"`)
    for (const field of ['priorSeasonId', 'nextSeasonId', 'deadlineAt', 'completedAt', 'archivedAt', 'createdByUserId']) expect(stage2).toContain(`"${field}"`)
    expect(stage2).toContain('league_renewal_slots_renewalId_franchiseId_key')
    expect(stage2).toContain('redraft_seasons_leagueId_season_key')
    expect(stage2).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE)/i)
  })

  it('backfills only an exact franchise match and is retry-safe', () => {
    expect(stage2).toContain('WHERE matches = 1')
    expect(stage2).toContain('s."franchiseId" IS NULL')
    expect(stage2).toContain('"priorManagerId" = s."userId"')
  })

  it('writes franchise identity for newly opened renewals', () => {
    expect(runtime).toContain('franchiseId: t.id')
    expect(runtime).toContain('priorManagerId: t.platformUserId!')
    expect(runtime).toContain('candidateManagerId: input.decision')
  })
})
