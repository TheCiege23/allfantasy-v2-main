/**
 * Commissioner OS · T-104 acceptance, TYPE-LEVEL half.
 *
 * "`ActionKey` is exhaustive so a missing row is a compile error."
 *
 * 🛑 NOT RUN. COMPILED. Vitest does not typecheck, so this assertion cannot be
 * made in a `.test.ts` — a `@ts-expect-error` there is a comment. Verified by:
 *
 *     npm run test:commissioner-os:types
 *
 * A `@ts-expect-error` that turns out to be unnecessary is itself an error
 * ("Unused '@ts-expect-error' directive"), so this file fails BOTH ways: if the
 * exhaustiveness guarantee breaks, and if it becomes vacuous.
 */

import type { ActionKey, ActionRule } from '@/lib/domain/authorize'
import { PERMISSION_MATRIX, createAuthorize } from '@/lib/domain/authorize'

// ─── 1 · A missing row is a compile error ────────────────────────────────────
// The whole claim. `Record<ActionKey, ActionRule>` is the only shape TypeScript
// enforces this on — a Map, a lookup with a default, or Partial<Record<…>> all
// accept the omission and fail at runtime, as a refusal, which is
// indistinguishable from the matrix working correctly.

// @ts-expect-error — every key but one; the omission must not compile.
const _missingRow: Record<ActionKey, ActionRule> = {
  'tenant.provision': { write: true, scope: 'platform', platform: ['PLATFORM_ADMIN'] },
  'tenant.suspend': { write: true, scope: 'platform', platform: ['PLATFORM_ADMIN'] },
  'tenant.changePlan': { write: true, scope: 'platform', platform: ['PLATFORM_ADMIN'] },
  'tenant.crossTenantRead': { write: false, scope: 'platform', platform: ['PLATFORM_ADMIN'] },
  'tenant.delete': { write: true, scope: 'tenant', tenant: ['TENANT_OWNER'] },
  'tenant.member.invite': { write: true, scope: 'tenant', tenant: ['TENANT_OWNER'] },
  'tenant.member.changeRole': { write: true, scope: 'tenant', tenant: ['TENANT_OWNER'] },
  'tenant.member.remove': { write: true, scope: 'tenant', tenant: ['TENANT_OWNER'] },
  'tenant.apiKey.issue': { write: true, scope: 'tenant', tenant: ['TENANT_OWNER'] },
  'tenant.apiKey.revoke': { write: true, scope: 'tenant', tenant: ['TENANT_OWNER'] },
  'tenant.webhook.configure': { write: true, scope: 'tenant', tenant: ['TENANT_OWNER'] },
  'tenant.export': { write: false, scope: 'tenant', tenant: ['TENANT_OWNER'] },
  'league.settings.update': { write: true, scope: 'league', league: ['COMMISSIONER'] },
  'league.phase.advance': { write: true, scope: 'league', league: ['COMMISSIONER'] },
  'audit.read': { write: false, scope: 'league', league: ['COMMISSIONER'] },
  'analytics.read': { write: false, scope: 'league', league: ['COMMISSIONER'] },
  'data.readDeleted': { write: false, scope: 'league', tenant: ['TENANT_SUPPORT'] },
  // 'data.purgeLeague' deliberately omitted.
}

// ─── 2 · An unknown key is a compile error too ───────────────────────────────

const _unknownKey: Record<ActionKey, ActionRule> = {
  ...PERMISSION_MATRIX,
  // @ts-expect-error — 'tenant.provisionn' is not an ActionKey.
  'tenant.provisionn': { write: true, scope: 'platform', platform: ['PLATFORM_ADMIN'] },
}

// ─── 3 · Roles are closed per axis ───────────────────────────────────────────
// A typo'd role name silently grants nobody, which reads as a deliberate
// restriction rather than as a mistake — so the type has to catch it.

const _badPlatformRole: ActionRule = {
  write: true,
  scope: 'platform',
  // @ts-expect-error — 'PLATFORM_GOD' is not a PlatformRole.
  platform: ['PLATFORM_GOD'],
}

const _crossedAxis: ActionRule = {
  write: true,
  scope: 'league',
  // @ts-expect-error — a tenant role is not a league role.
  league: ['TENANT_ADMIN'],
}

// ─── 4 · What MUST still compile ─────────────────────────────────────────────
// Without these the file could pass by making everything an error.

const _ok: Record<ActionKey, ActionRule> = PERMISSION_MATRIX
const _authorize = createAuthorize(PERMISSION_MATRIX)

void _missingRow
void _unknownKey
void _badPlatformRole
void _crossedAxis
void _ok
void _authorize
