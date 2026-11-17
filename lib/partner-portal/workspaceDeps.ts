import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveTenantsForUser, withTenant } from '@/lib/domain/db'
import { createActorContext } from '@/lib/domain/actorContext'
import { authorize } from '@/lib/domain/authorize'
import type { BindingRow, LeagueFacts, PortalDeps, TenantRoleName } from '@/lib/partner-portal/workspace'

/**
 * The production wiring for lib/partner-portal/workspace.ts. Kept apart so the read path is testable without a
 * database and this file stays a list of the exact calls made.
 */
export const portalDeps: PortalDeps = {
  resolveTenantsForUser: async (userId) =>
    (await resolveTenantsForUser(userId)).map((m) => ({ tenantId: m.tenantId, role: m.role as TenantRoleName })),

  authorizeRead: async ({ userId, actorLabel, tenantId, role }) => {
    const ctx = createActorContext({ userId, actorLabel, tenantId, tenantRole: role })
    if (!ctx.ok) return false
    // ⚠ AWAITED — see the note in app/api/commissioner-os/sync-health/route.ts: `.ok` read off an un-awaited
    // promise is undefined and would refuse everyone.
    const allowed = await authorize({ ctx: ctx.value, requires: 'analytics.read', resource: { tenantId: ctx.value.tenantId } })
    return allowed.ok
  },

  readWorkspace: (tenantId) =>
    withTenant(tenantId, async (tx) => {
      // No `where: { tenantId }` on either read: row-level security supplies it (lib/domain/db.ts §2).
      const t = tx as unknown as {
        tenant: { findFirst: (a: unknown) => Promise<{ name: string } | null> }
        leagueBinding: { findMany: (a: unknown) => Promise<BindingRow[]> }
      }
      const tenant = await t.tenant.findFirst({ select: { name: true } })
      const bindings = await t.leagueBinding.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          leagueId: true,
          provider: true,
          status: true,
          consecutiveFailures: true,
          lastSyncedAt: true,
          lastErrorAt: true,
          lastErrorSummary: true,
        },
        orderBy: { id: 'asc' },
      })
      return { name: tenant?.name ?? null, bindings }
    }),

  // BY ID ONLY, and only ids from the RLS-filtered bindings above (see the header of workspace.ts).
  readLeagueFacts: async (leagueIds): Promise<LeagueFacts> => {
    const [leagues, snapshots, managers] = await Promise.all([
      prisma.league.findMany({ where: { id: { in: leagueIds } }, select: { id: true, name: true, sport: true } }),
      prisma.intelligenceLeagueSnapshot.findMany({
        where: { leagueId: { in: leagueIds } },
        select: { leagueId: true, lastActivityAt: true, totalEvents: true, openTradeProposals: true },
      }),
      prisma.intelligenceManagerSnapshot.findMany({
        where: { leagueId: { in: leagueIds } },
        select: { leagueId: true, managerKey: true, lastActiveAt: true },
      }),
    ])
    return { leagues: leagues.map((l) => ({ id: l.id, name: l.name, sport: l.sport ? String(l.sport) : null })), snapshots, managers }
  },
}
