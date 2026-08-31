/**
 * Commissioner OS · the canonical register of tenant-scoped tables. T-102.
 *
 * One list, consumed by the T-102 migration's policy loop, the isolation suite,
 * and (next) T-103's coverage test. TENANCY.md §3.5 exists because "fifteen-plus
 * tables need identical policies applied by hand, forever" and the failure mode
 * is someone adding a table in month eight and forgetting — a register that
 * three things read is harder to forget than a checklist.
 *
 * ⚠ `rlsEnabled: false` IS NOT "NOT DONE YET". It records a table that carries
 * `tenantId` and deliberately has NO policy, with the reason. T-103 will fail on
 * every one of them, which is correct — the entry is what makes that failure a
 * known decision rather than a discovery.
 */

export type TenantScopedTable = {
  /** Prisma model name — what `schema.prisma` declares. */
  readonly model: string
  /**
   * Postgres table name, as quoted in SQL.
   *
   * ⚠ NOT ALWAYS THE MODEL NAME. 627 of this repo's models carry `@@map`, and
   * all five pre-existing tenantId tables do. This register listed them by
   * MODEL name until T-103 enumerated the schema and caught it — which meant
   * T-102's deferred-table check queried `pg_class` for names that do not
   * exist, found zero rows, and looped over them asserting nothing. A vacuous
   * pass, in the register whose whole job is to stop things being forgotten.
   */
  readonly table: string
  /**
   * The column the policy keys on. `Tenant` is the exception: it has no
   * `tenantId`, so its policy keys on its own primary key (TENANCY.md §5).
   */
  readonly keyColumn: 'tenantId' | 'id'
  readonly rlsEnabled: boolean
  readonly note?: string
}

export const TENANT_SCOPED_TABLES: readonly TenantScopedTable[] = [
  // ── Enabled by T-102. Nothing outside Commissioner OS reads these, so
  //    forcing RLS on them cannot affect the live product.
  { model: 'Tenant', table: 'Tenant', keyColumn: 'id', rlsEnabled: true },
  { model: 'TenantUser', table: 'TenantUser', keyColumn: 'tenantId', rlsEnabled: true },
  { model: 'TenantMember', table: 'TenantMember', keyColumn: 'tenantId', rlsEnabled: true },
  { model: 'TenantApiKey', table: 'TenantApiKey', keyColumn: 'tenantId', rlsEnabled: true },
  { model: 'TenantWebhook', table: 'TenantWebhook', keyColumn: 'tenantId', rlsEnabled: true },
  { model: 'AuditEvent', table: 'AuditEvent', keyColumn: 'tenantId', rlsEnabled: true },

  // T-201. Registered in the SAME change that adds the models, because T-103
  // fails on an unregistered tenantId model — and it did, by name, before this
  // entry existed:
  //
  //   Models carry tenantId but are neither RLS-protected nor registered as
  //   deferred: LeagueBinding, SyncJob
  //
  // That failure is the §3.5 coverage mechanism catching a table on the day it
  // is added rather than in month nine. It is not an obstacle to route around.
  { model: 'LeagueBinding', table: 'LeagueBinding', keyColumn: 'tenantId', rlsEnabled: true },
  { model: 'SyncJob', table: 'SyncJob', keyColumn: 'tenantId', rlsEnabled: true },

  // ── NOT enabled, and each one is a decision.
  {
    model: 'League',
    table: 'leagues',
    keyColumn: 'tenantId',
    rlsEnabled: false,
    note:
      'Forcing RLS here today is a guaranteed outage, not a risk. Measured: 1,020 AllFantasy ' +
      'call sites read this table and ZERO code connects as commish_app — so with policies ' +
      'scoped TO the commish_* roles, every one of those 1,020 returns zero rows. Prerequisite ' +
      'is that the AllFantasy read path either connects as a role that has a policy, or gets ' +
      'an explicit legacy policy of its own. Neither is a Commissioner OS decision.',
  },
  {
    model: 'TradeExecutionSnapshot',
    table: 'trade_execution_snapshots',
    keyColumn: 'tenantId',
    rlsEnabled: false,
    note: 'Pre-existing tenantId @default("allfantasy") from an earlier FK-less attempt. AllFantasy-owned.',
  },
  {
    model: 'DomainEvent',
    table: 'domain_events',
    keyColumn: 'tenantId',
    rlsEnabled: false,
    note:
      'Same pre-existing column. ⚠ ALSO the outbox T-007 writes to, inside the mutation ' +
      'transaction — enabling RLS here without a policy for whichever role runs the relay ' +
      'stops event delivery silently, and a relay that finds nothing looks exactly like a ' +
      'relay with nothing to do.',
  },
  {
    model: 'AuditFeedEntry',
    table: 'event_audit_feed',
    keyColumn: 'tenantId',
    rlsEnabled: false,
    note: 'Same pre-existing column. A projection over DomainEvent.',
  },
  {
    model: 'IntelligenceLeagueSnapshot',
    table: 'intelligence_league_snapshot',
    keyColumn: 'tenantId',
    rlsEnabled: false,
    note: 'Same pre-existing column. AllFantasy-owned.',
  },
  {
    model: 'IntelligenceLeagueSnapshotHistory',
    table: 'intelligence_league_snapshot_history',
    keyColumn: 'tenantId',
    rlsEnabled: false,
    note: 'Same pre-existing column. AllFantasy-owned.',
  },
]

/**
 * Not tenant-scoped, and deliberately so.
 *
 * `PlatformGrant` holds platform staff roles. It has no `tenantId` because it
 * is not an operator's data — but it still needs RLS, because the DEFAULT for a
 * table with RLS enabled and no matching policy is "no rows", and the default
 * for a table WITHOUT RLS is "every row to anyone with SELECT". A table that
 * decides who is a platform admin must not be the second kind.
 */
export const PLATFORM_TABLES = ['PlatformGrant'] as const

export const rlsEnabledTables = () => TENANT_SCOPED_TABLES.filter((t) => t.rlsEnabled)
export const rlsDeferredTables = () => TENANT_SCOPED_TABLES.filter((t) => !t.rlsEnabled)
