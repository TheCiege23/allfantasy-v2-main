/**
 * Commissioner OS · T-003 acceptance, TYPE-LEVEL half.
 *
 * "`ActorContext` cannot be constructed without `tenantId` — enforced at the
 * type level, not by convention."
 *
 * 🛑 THIS FILE IS NOT RUN. IT IS COMPILED.
 * Vitest does not typecheck, so a `@ts-expect-error` in a `.test.ts` asserts
 * nothing at all — it is a comment. This file is deliberately named
 * `.types.ts` so neither vitest config collects it, and it is verified by
 * running the compiler over it:
 *
 *     npx tsc --noEmit --strict --skipLibCheck \
 *       __tests__/commissioner-os/actorContext.types.ts
 *
 * A `@ts-expect-error` that turns out to be unnecessary is itself an error
 * ("Unused '@ts-expect-error' directive"), so this file fails BOTH ways: if the
 * guarantee breaks, and if the guarantee becomes vacuous. That is what makes it
 * a real check rather than a comment claiming one.
 */

import type { ActorContext, ActorContextInput } from '@/lib/domain/actorContext'
import { createActorContext } from '@/lib/domain/actorContext'

// ─── 1 · tenantId is required at the type level ──────────────────────────────

// @ts-expect-error — tenantId is missing.
const _missingTenant: ActorContextInput = {
  userId: 'u1',
  actorLabel: 'Dana',
}

const _nullTenant: ActorContextInput = {
  userId: 'u1',
  actorLabel: 'Dana',
  // @ts-expect-error — tenantId cannot be null.
  tenantId: null,
}

const _undefinedTenant: ActorContextInput = {
  userId: 'u1',
  actorLabel: 'Dana',
  // @ts-expect-error — tenantId cannot be undefined.
  tenantId: undefined,
}

// ─── 2 · An ActorContext cannot be forged ────────────────────────────────────
// The point of the brand. A required property alone would not stop either of
// these, and both are what gets written at a route boundary under deadline.

// @ts-expect-error — an object literal cannot satisfy the brand.
const _forgedLiteral: ActorContext = {
  userId: 'u1',
  actorLabel: 'Dana',
  tenantId: 't1',
  platformRole: null,
  tenantRole: null,
  leagueRole: null,
  requestId: 'r1',
}

// @ts-expect-error — casting an unbranded object is not sufficient either.
const _forgedCast: ActorContext = {
  userId: 'u1',
  actorLabel: 'Dana',
  tenantId: 't1',
  platformRole: null,
  tenantRole: null,
  leagueRole: null,
  requestId: 'r1',
} as { userId: string; actorLabel: string; tenantId: string }

// ─── 3 · Roles are closed sets ───────────────────────────────────────────────

const _badTenantRole: ActorContextInput = {
  userId: 'u1',
  actorLabel: 'Dana',
  tenantId: 't1',
  // @ts-expect-error — 'TENANT_GOD' is not a TenantRole.
  tenantRole: 'TENANT_GOD',
}

const _crossedAxis: ActorContextInput = {
  userId: 'u1',
  actorLabel: 'Dana',
  tenantId: 't1',
  // @ts-expect-error — a league role is not a platform role.
  platformRole: 'COMMISSIONER',
}

// ─── 4 · What MUST still compile ─────────────────────────────────────────────
// Without these the file could pass by making everything an error.

const _ok: ActorContextInput = {
  userId: 'u1',
  actorLabel: 'Dana',
  tenantId: 't1',
  platformRole: 'PLATFORM_ADMIN',
  tenantRole: 'TENANT_OWNER',
  leagueRole: 'CO_COMMISSIONER',
  onBehalfOfLeagueId: 'l1',
  reason: 'Restoring a week after a scoring correction.',
}

const _built = createActorContext(_ok)

// And the Result narrows to a real ActorContext on the success branch.
if (_built.ok) {
  const _ctx: ActorContext = _built.value
  const _tenantId: string = _ctx.tenantId
  void _ctx
  void _tenantId
}

void _missingTenant
void _nullTenant
void _undefinedTenant
void _forgedLiteral
void _forgedCast
void _badTenantRole
void _crossedAxis
void _built
