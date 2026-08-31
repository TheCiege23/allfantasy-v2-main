/**
 * Commissioner OS · role parity.
 *
 * `lib/domain/roles.ts` declares the three role axes in TypeScript because the
 * generated Prisma client in this checkout predates the T-101 merge and does
 * not contain the enums. A duplicated constant nobody checks is how two sources
 * of truth diverge, so this asserts the lists match the enum bodies in
 * `prisma/schema.prisma`.
 *
 * ⚠ IT PARSES THE SCHEMA TEXT, NOT THE GENERATED CLIENT — on purpose. The text
 * is the source of truth and is always present; the generated client is a build
 * artifact that may be stale, and asserting against a stale artifact would let
 * both sides be wrong together.
 *
 * Delete this file in the same commit that replaces `roles.ts` with
 * `import type { … } from '@prisma/client'`.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROLE_ENUM_SOURCES } from '@/lib/domain/roles'

const SCHEMA = readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')

/**
 * Pull the members of `enum <name> { … }` out of the schema.
 *
 * Values carry trailing `//` comments in tenancy.prisma
 * (`TENANT_OWNER    // billing + can delete the tenant`), so the comment is
 * stripped before the identifier is read.
 *
 * ⚠ THE STRIP IS `/\/\/.*\/` WITH NO `$` ANCHOR, AND THAT IS NOT A TYPO.
 * `schema.prisma` has CRLF endings, and JavaScript's `.` does not match `\r`.
 * With `/\/\/.*$/` the `.*` stops before the `\r`, `$` then fails to match, and
 * the regex silently does not fire — every value comes back with its comment
 * still attached. The positive control below is what caught it; without that
 * test the parser would have "worked" for the three enums that happen to carry
 * no comments and been wrong about the rest.
 *
 * Returns null when the enum is absent,
 * which the tests treat as a failure rather than as an empty list — an enum that
 * vanished and an enum with no members are very different facts.
 */
function enumMembers(name: string): string[] | null {
  const match = new RegExp(`^enum\\s+${name}\\s*\\{([^}]*)\\}`, 'm').exec(SCHEMA)
  if (!match) return null
  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*/, '').trim())
    .filter((line) => line.length > 0)
}

describe('role unions match prisma/schema.prisma', () => {
  it('the parser finds a known enum (positive control)', () => {
    // Without this, a regex that matches nothing makes every assertion below
    // pass vacuously — enumMembers would return null for all of them and the
    // toEqual comparisons would never run against real data.
    expect(enumMembers('TenantStatus')).toEqual([
      'TRIAL',
      'ACTIVE',
      'PAST_DUE',
      'SUSPENDED',
      'CLOSED',
    ])
  })

  it('the parser returns null for an enum that does not exist', () => {
    // The other half of the control: proves null means absent rather than
    // "matched but empty".
    expect(enumMembers('NoSuchEnumAnywhere')).toBeNull()
  })

  it.each(Object.entries(ROLE_ENUM_SOURCES))('%s', (enumName, declared) => {
    const inSchema = enumMembers(enumName)
    expect(inSchema, `enum ${enumName} is missing from prisma/schema.prisma`).not.toBeNull()
    expect(inSchema).toEqual([...declared])
  })

  it('covers every role axis the domain layer declares', () => {
    // Adding a fourth axis to roles.ts without a ROLE_ENUM_SOURCES entry would
    // otherwise go unchecked forever.
    expect(Object.keys(ROLE_ENUM_SOURCES).sort()).toEqual([
      'LeagueRole',
      'PlatformRoleKind',
      'TenantRole',
    ])
  })
})
