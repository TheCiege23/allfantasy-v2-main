/**
 * Commissioner OS · the three role axes. T-003.
 *
 * ⚠ DECLARED HERE RATHER THAN IMPORTED FROM `@prisma/client`, AND THAT IS A
 * COMPROMISE WITH AN EXPIRY DATE.
 *
 * The enums exist in `prisma/schema.prisma` (merged at T-101) but the generated
 * client in this checkout predates that merge — `TenantRole`, `LeagueRole` and
 * `PlatformRoleKind` are not in it. Importing them would not compile, and
 * running `prisma generate` mutates a `node_modules` shared by ~9 concurrent
 * sessions, which is not a side effect T-003 should have.
 *
 * So they are declared, and `__tests__/commissioner-os/roleParity.test.ts`
 * asserts these lists match the enum bodies in `schema.prisma` — parsed from the
 * schema TEXT, so the check works with no generated client and no database. A
 * duplicated constant nobody checks is how two sources of truth diverge; a
 * duplicated constant with a parity test is just a cache.
 *
 * Once the client is regenerated, replace these with `import type` from
 * `@prisma/client` and delete the parity test in the same commit.
 */

/**
 * The operator's own staff. From `TENANCY.md` §6.
 * TENANT_SUPPORT is read-only — T-104 asserts it holds no write action at all.
 */
export const TENANT_ROLES = ['TENANT_OWNER', 'TENANT_ADMIN', 'TENANT_SUPPORT'] as const
export type TenantRole = (typeof TENANT_ROLES)[number]

/** Us. Stored on `PlatformGrant`, never as a column on a user table. */
export const PLATFORM_ROLES = ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]

/** Inside one league. */
export const LEAGUE_ROLES = ['COMMISSIONER', 'CO_COMMISSIONER', 'MANAGER'] as const
export type LeagueRole = (typeof LEAGUE_ROLES)[number]

/**
 * The Prisma enum each list mirrors. Used by the parity test; kept beside the
 * lists so adding a fourth axis without a parity entry is visible here.
 *
 * ⚠ `PlatformRole` maps to the enum `PlatformRoleKind`. The names differ on
 * purpose — `CLAUDE.md`'s ActorContext calls the field's type `PlatformRole`
 * while `tenancy.prisma` names the enum `PlatformRoleKind`. Renaming either to
 * match would edit a supplied spec; recording the mapping is cheaper and does
 * not lose the fact that they are the same set.
 */
export const ROLE_ENUM_SOURCES = {
  TenantRole: TENANT_ROLES,
  PlatformRoleKind: PLATFORM_ROLES,
  LeagueRole: LEAGUE_ROLES,
} as const
