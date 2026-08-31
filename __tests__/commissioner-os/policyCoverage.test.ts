/**
 * Commissioner OS · T-103 — policy coverage.
 *
 * TENANCY.md §3.5: "Fifteen-plus tables need identical policies applied by
 * hand, forever. The failure mode is someone adding a table in month eight and
 * forgetting."
 *
 * ─── WHY THIS IS A RATCHET AND NOT A BINARY ──────────────────────────────────
 * The ticket's literal form — "every table with a tenantId column has RLS and
 * at least one policy" — is RED TODAY, on six tables, for reasons that are
 * already decided and written down. `leagues` cannot take RLS without an
 * outage across 1,020 call sites; the five pre-existing `@default("allfantasy")`
 * tables belong to AllFantasy.
 *
 * A test that is permanently red for a known reason is one nobody reads, and
 * this whole codebase has spent the session cataloguing checks that stopped
 * meaning anything. So the assertion is:
 *
 *     every model carrying `tenantId` is EITHER protected OR registered as
 *     deliberately deferred, with a written reason
 *
 * That is green today, and it still fails on exactly the case the acceptance
 * criterion names — "add a table with tenantId and no policy" — because a new
 * model is in neither set. The month-eight table is caught the moment the MODEL
 * lands, before any migration exists, which is earlier than a database check
 * could manage.
 *
 * The database half (`relrowsecurity` / `relforcerowsecurity` / `pg_policies`,
 * the ticket's literal wording) is `policyCoverage.spec.ts`. It needs a live
 * database; this needs nothing and therefore runs in CI, which is where the
 * ticket wants it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  TENANT_SCOPED_TABLES,
  rlsDeferredTables,
  rlsEnabledTables,
} from '@/lib/domain/tenantScopedTables'

const SCHEMA = readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')

type SchemaModel = { model: string; table: string; hasTenantId: boolean }

/**
 * Every model in the schema, with its mapped table name.
 *
 * ⚠ `@@map` MATTERS AND IS EASY TO MISS. 627 of this repo's 711 models carry
 * one, including all five pre-existing tenantId tables — `DomainEvent` is
 * `domain_events`, `AuditFeedEntry` is `event_audit_feed`. The register listed
 * those by MODEL name until this test enumerated the schema and caught it,
 * which had made T-102's deferred-table check query `pg_class` for names that
 * do not exist: zero rows, a loop over zero rows, and a vacuous pass.
 */
function parseModels(): SchemaModel[] {
  return [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, model, body]) => {
    const mapped = /@@map\("([^"]+)"\)/.exec(body)
    return {
      model,
      table: mapped ? mapped[1] : model,
      hasTenantId: /^\s+tenantId\s/m.test(body),
    }
  })
}

const MODELS = parseModels()
const WITH_TENANT_ID = MODELS.filter((m) => m.hasTenantId)

describe('T-103 · the parser can see the schema (positive control)', () => {
  it('finds a realistic number of models', () => {
    // A regex that matches nothing yields an empty model list, and every
    // coverage assertion below then passes having examined nothing at all.
    expect(MODELS.length).toBeGreaterThan(500)
  })

  it('finds models that carry tenantId', () => {
    expect(WITH_TENANT_ID.length).toBeGreaterThan(5)
  })

  it('resolves @@map to the real table name', () => {
    // The specific thing that was wrong. Pinned so the register cannot drift
    // back to model names without this failing.
    const domainEvent = MODELS.find((m) => m.model === 'DomainEvent')
    expect(domainEvent?.table).toBe('domain_events')
    const league = MODELS.find((m) => m.model === 'League')
    expect(league?.table).toBe('leagues')
  })
})

describe('T-103 · every tenantId model is accounted for', () => {
  it('🛑 no model carrying tenantId is unregistered', () => {
    // THE TEST. A model added in month eight with a tenantId and no policy is
    // in neither the protected set nor the deferred register, and lands here.
    //
    // It fires on the MODEL, not on the migration — so it catches the omission
    // at the moment the schema changes, before anyone has written the policy
    // they were going to forget.
    const registered = new Set(TENANT_SCOPED_TABLES.map((t) => t.model))
    const unregistered = WITH_TENANT_ID.filter((m) => !registered.has(m.model)).map((m) => m.model)

    expect(
      unregistered,
      `Models carry tenantId but are neither RLS-protected nor registered as deferred: ${unregistered.join(', ')}. ` +
        `Add a policy in the T-102 migration and set rlsEnabled: true, or register it as deferred WITH A REASON in lib/domain/tenantScopedTables.ts.`,
    ).toEqual([])
  })

  it('the register does not name models that do not exist', () => {
    // The other direction. A stale entry means a policy loop referencing a
    // table that was renamed or dropped — which fails at CREATE POLICY, late,
    // on a database, instead of here.
    const modelNames = new Set(MODELS.map((m) => m.model))
    const stale = TENANT_SCOPED_TABLES.filter((t) => !modelNames.has(t.model)).map((t) => t.model)
    expect(stale, `register names models absent from schema.prisma: ${stale.join(', ')}`).toEqual([])
  })

  it('every register entry has the right mapped table name', () => {
    // Guards the bug this test found. The register's `table` must be what
    // Postgres actually calls it, because that is what pg_class is queried by.
    for (const entry of TENANT_SCOPED_TABLES) {
      const schemaModel = MODELS.find((m) => m.model === entry.model)
      expect(schemaModel, `${entry.model} not in schema`).toBeDefined()
      expect(
        entry.table,
        `${entry.model}: register says table "${entry.table}", schema maps it to "${schemaModel!.table}"`,
      ).toBe(schemaModel!.table)
    }
  })

  it('Tenant is the only registered model without a tenantId column', () => {
    // TENANCY.md §5: Tenant has no tenantId, so its policy keys on its own id.
    // Anything else in that position would be scoping to a row id and silently
    // matching nothing.
    const withoutTenantId = TENANT_SCOPED_TABLES.filter(
      (t) => !WITH_TENANT_ID.some((m) => m.model === t.model),
    ).map((t) => t.model)
    expect(withoutTenantId).toEqual(['Tenant'])
  })
})

describe('T-103 · deferrals are decisions, not gaps', () => {
  it('every deferred entry carries a substantive reason', () => {
    // A deferral with no reason is indistinguishable from an oversight, and
    // this test is the only thing standing between the two.
    for (const t of rlsDeferredTables()) {
      expect(t.note, `${t.model} deferred with no reason`).toBeTruthy()
      expect(t.note!.length, `${t.model}: reason too thin to evaluate`).toBeGreaterThan(40)
    }
  })

  it('the deferred set is exactly what was decided', () => {
    // Pinned by name. Adding to this list is meant to be a visible edit with a
    // reason attached, not something that happens quietly because a test was
    // getting in the way.
    expect(rlsDeferredTables().map((t) => t.model).sort()).toEqual([
      'AuditFeedEntry',
      'DomainEvent',
      'IntelligenceLeagueSnapshot',
      'IntelligenceLeagueSnapshotHistory',
      'League',
      'TradeExecutionSnapshot',
    ])
  })

  it('the protected set is non-empty', () => {
    // Without this, deferring everything would satisfy every other assertion in
    // this file — a coverage test that passes by covering nothing.
    expect(rlsEnabledTables().length).toBeGreaterThanOrEqual(6)
  })
})
