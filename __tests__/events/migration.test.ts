import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Static migration verification: the hand-authored migration must exist, be
 * additive + idempotent, and create the two tables the Prisma models map to.
 * The live application of this DDL is proven by outbox-db.integration.test.ts.
 */
const root = process.cwd()
const migrationSql = path.join(root, 'prisma/migrations/20260627010000_add_event_foundation/migration.sql')
const schemaPath = path.join(root, 'prisma/schema.prisma')

describe('G15.1 migration — domain_events + event_outbox', () => {
  it('migration file exists', () => {
    expect(existsSync(migrationSql)).toBe(true)
  })

  it('creates both tables idempotently and additively (no destructive DDL)', () => {
    const sql = readFileSync(migrationSql, 'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "domain_events"/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "event_outbox"/)
    // idempotent indexes
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "domain_events_eventId_key"/)
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "domain_events_idempotencyKey_key"/)
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "event_outbox_eventId_key"/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "event_outbox_status_availableAt_idx"/)
    // additive only — must not drop/alter existing tables
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i)
  })

  it('schema.prisma declares both models mapped to the new tables', () => {
    const schema = readFileSync(schemaPath, 'utf8')
    expect(schema).toMatch(/model DomainEvent \{/)
    expect(schema).toMatch(/@@map\("domain_events"\)/)
    expect(schema).toMatch(/model EventOutbox \{/)
    expect(schema).toMatch(/@@map\("event_outbox"\)/)
  })
})
