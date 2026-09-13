import { describe, expect, it } from 'vitest'
import {
  EMPTY_MIGRATION_MARKER,
  classifyDiff,
  classifyItem,
  compareToBaseline,
  interpretDiffRun,
  resolveDriftTargetUrl,
  splitStatements,
  toItems,
} from '../../scripts/check-schema-drift'

/**
 * Pure tests for the schema drift guard. Nothing here connects to a database.
 *
 * The statements below are copied from a real `prisma migrate diff --script` run against production
 * on 2026-09-13 (Prisma 5.22.0), CRLF line endings and `-- Header` comments included, because a
 * parser tested only against hand-typed SQL is a parser tested against what its author expected.
 */
const REAL_DIFF = [
  '-- CreateEnum',
  `CREATE TYPE "commissioner_succession_status" AS ENUM ('pending', 'approved', 'rejected', 'completed', 'expired');`,
  '',
  '-- DropForeignKey',
  'ALTER TABLE "rosters" DROP CONSTRAINT "rosters_redraftRosterId_fkey";',
  '',
  '-- DropIndex',
  'DROP INDEX "draft_sessions_leagueId_seasonYear_key";',
  '',
  '-- AlterTable',
  'ALTER TABLE "PlayerValueSnapshot" DROP COLUMN "marketNumTeams",',
  'DROP COLUMN "marketPpr",',
  'DROP COLUMN "observedAt";',
  '',
  '-- AlterTable',
  'ALTER TABLE "concept_presets" ALTER COLUMN "roster_slots" DROP DEFAULT,',
  'ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);',
  '',
  '-- DropTable',
  'DROP TABLE "decision_strategy_events";',
  '',
  '-- CreateTable',
  'CREATE TABLE "resume_snapshots" (',
  '    "id" TEXT NOT NULL,',
  '    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '',
  '    CONSTRAINT "resume_snapshots_pkey" PRIMARY KEY ("id")',
  ');',
  '',
  '-- CreateIndex',
  'CREATE UNIQUE INDEX "resume_snapshots_userId_key" ON "resume_snapshots"("userId");',
  '',
  '-- AddForeignKey',
  'ALTER TABLE "rosters" ADD CONSTRAINT "rosters_redraftRosterId_fkey" FOREIGN KEY ("redraftRosterId") REFERENCES "redraft_rosters"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
  '',
  '-- RenameIndex',
  'ALTER INDEX "PlayerValueSnapshot_player_idx" RENAME TO "PlayerValueSnapshot_sleeperId_capturedAt_idx";',
  '',
].join('\r\n')

describe('parsing real migrate diff output', () => {
  it('splits CRLF output into statements and drops the -- headers', () => {
    const statements = splitStatements(REAL_DIFF)
    expect(statements).toHaveLength(10)
    expect(statements.some((s) => s.includes('--'))).toBe(false)
    expect(statements[6]).toMatch(/^CREATE TABLE "resume_snapshots" \( "id" TEXT NOT NULL,/)
  })

  it('splits ALTER TABLE per clause but keeps a FOREIGN KEY column list whole', () => {
    expect(toItems('ALTER TABLE "PlayerValueSnapshot" DROP COLUMN "marketNumTeams", DROP COLUMN "marketPpr"')).toEqual([
      'ALTER TABLE "PlayerValueSnapshot" DROP COLUMN "marketNumTeams"',
      'ALTER TABLE "PlayerValueSnapshot" DROP COLUMN "marketPpr"',
    ])
    const fk =
      'ALTER TABLE "t" ADD CONSTRAINT "t_a_b_fkey" FOREIGN KEY ("a", "b") REFERENCES "u"("a", "b") ON DELETE CASCADE ON UPDATE CASCADE'
    expect(toItems(fk)).toEqual([fk])
  })

  it('classifies every item in the real diff', () => {
    const kinds = classifyDiff(REAL_DIFF).map((i) => `${i.destructive ? '!' : '+'}${i.kind}`)
    expect(kinds).toEqual([
      '+type-definition',
      '!drop-constraint',
      '!drop-index',
      '!drop-column',
      '!drop-column',
      '!drop-column',
      '+column-default',
      '!type-change',
      '!drop-table',
      '+create-table',
      '+create-index',
      '+add-constraint',
      '+rename-index',
    ])
  })
})

describe('destructive classification', () => {
  // The original guard matched only `DROP (TABLE|COLUMN|CONSTRAINT)`. Each case below is one it missed.
  it.each([
    ['DROP INDEX "commissioner_report_runs_league_id_generated_at_idx"', 'drop-index'],
    ['ALTER TABLE "fantasy_players" ALTER COLUMN "fetched_at" SET DATA TYPE TIMESTAMP(3)', 'type-change'],
    ['ALTER TABLE "ai_interaction_logs" DROP CONSTRAINT "ai_interaction_logs_pkey"', 'drop-primary-key'],
    ['DROP TYPE "franchise_event_type_old"', 'drop-other'],
    ['TRUNCATE "users"', 'drop-other'],
  ])('%s is destructive (%s)', (sql, kind) => {
    expect(classifyItem(sql)).toMatchObject({ kind, destructive: true })
  })

  it('fails closed: a statement shape no rule knows is destructive', () => {
    expect(classifyItem('ALTER TABLE "x" SET UNLOGGED')).toMatchObject({ kind: 'unrecognised', destructive: true })
  })

  it('a primary-key rebuild yields a destructive item even though it re-adds the key', () => {
    const items = classifyDiff(
      'ALTER TABLE "ai_interaction_logs" DROP CONSTRAINT "ai_interaction_logs_pkey",\nALTER COLUMN "id" SET DATA TYPE TEXT,\nADD CONSTRAINT "ai_interaction_logs_pkey" PRIMARY KEY ("id");',
    )
    expect(items.map((i) => i.kind)).toEqual(['drop-primary-key', 'type-change', 'add-constraint'])
    expect(items.filter((i) => i.destructive)).toHaveLength(2)
  })
})

describe('interpreting the prisma run — only two outcomes are verdicts', () => {
  const empty = `-- ${EMPTY_MIGRATION_MARKER}\n\n`

  it('exit 0 with the marker is clean', () => {
    expect(interpretDiffRun({ status: 0, stdout: empty, stderr: '' })).toEqual({ verdict: 'clean' })
  })

  it('🛑 exit 0 with NO output is an error, not clean — the npx false-clean the original shipped', () => {
    expect(interpretDiffRun({ status: 0, stdout: '', stderr: '' })).toMatchObject({ verdict: 'error' })
  })

  it('exit 0 that printed statements is an error', () => {
    expect(interpretDiffRun({ status: 0, stdout: REAL_DIFF, stderr: '' })).toMatchObject({ verdict: 'error' })
  })

  it('exit 2 with statements is drift', () => {
    const v = interpretDiffRun({ status: 2, stdout: REAL_DIFF, stderr: '' })
    expect(v.verdict).toBe('drift')
    expect(v.verdict === 'drift' && v.items).toHaveLength(13)
  })

  it('exit 2 with nothing parseable is an error', () => {
    expect(interpretDiffRun({ status: 2, stdout: empty, stderr: '' })).toMatchObject({ verdict: 'error' })
  })

  it.each([1, 3, 124, 127, 143])('exit %i is an error', (status) => {
    expect(interpretDiffRun({ status, stdout: '', stderr: 'boom' })).toMatchObject({ verdict: 'error' })
  })

  it('a killed process and a spawn failure are errors', () => {
    expect(interpretDiffRun({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' })).toMatchObject({ verdict: 'error' })
    expect(interpretDiffRun({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') })).toMatchObject({
      verdict: 'error',
    })
  })

  it('never echoes a connection-string password from prisma stderr', () => {
    const stderr = "Error: P1001: Can't reach database server at postgresql://neondb_owner:s3cretPw9@ep-x.neon.tech/neondb"
    const v = interpretDiffRun({ status: 1, stdout: '', stderr })
    expect(v.verdict).toBe('error')
    const reason = v.verdict === 'error' ? v.reason : ''
    expect(reason).not.toContain('s3cretPw9')
    expect(reason).toContain('P1001')
  })
})

describe('baseline comparison', () => {
  const items = classifyDiff(REAL_DIFF)
  const baseline = items.map((i) => i.text)

  it('the same diff against its own baseline adds nothing', () => {
    expect(compareToBaseline(items, baseline)).toEqual({ added: [], resolved: [] })
  })

  it('a new DROP COLUMN on a table that already has baseline drift is caught as its own item', () => {
    const grown = classifyDiff(
      `${REAL_DIFF}\r\n-- AlterTable\r\nALTER TABLE "PlayerValueSnapshot" DROP COLUMN "sleeperId";\r\n`,
    )
    const { added } = compareToBaseline(grown, baseline)
    expect(added).toEqual([
      { text: 'ALTER TABLE "PlayerValueSnapshot" DROP COLUMN "sleeperId"', kind: 'drop-column', destructive: true },
    ])
  })

  it('reports baseline items that are gone, and does not count them as added', () => {
    const shrunk = items.filter((i) => i.kind !== 'drop-table')
    expect(compareToBaseline(shrunk, baseline)).toEqual({ added: [], resolved: ['DROP TABLE "decision_strategy_events"'] })
  })

  it('duplicates are reported once', () => {
    const dup = [...items, classifyItem('DROP TABLE "brand_new"'), classifyItem('DROP TABLE "brand_new"')]
    expect(compareToBaseline(dup, baseline).added).toHaveLength(1)
  })
})

describe('target URL resolution follows the Prisma CLI', () => {
  const file = { DATABASE_URL: 'postgresql://f/db', DIRECT_URL: 'postgresql://fd/db' }

  it('environment beats .env, and DIRECT_URL beats DATABASE_URL', () => {
    expect(resolveDriftTargetUrl({ DATABASE_URL: 'postgresql://e/db', DIRECT_URL: 'postgresql://ed/db' }, file)?.source).toBe(
      'environment DIRECT_URL',
    )
    expect(resolveDriftTargetUrl({ DATABASE_URL: 'postgresql://e/db' }, file)?.source).toBe('environment DATABASE_URL')
    expect(resolveDriftTargetUrl({}, file)?.source).toBe('.env DIRECT_URL')
    expect(resolveDriftTargetUrl({}, { DATABASE_URL: 'postgresql://f/db' })?.source).toBe('.env DATABASE_URL')
  })

  it('nothing configured is null, not a default', () => {
    expect(resolveDriftTargetUrl({}, {})).toBeNull()
  })
})
