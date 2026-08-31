/**
 * Commissioner OS · T-005 acceptance.
 *
 * "Run ESLint programmatically against a fixture containing each violation and
 * assert it errors; exclude the fixture path from the normal lint run so CI
 * isn't permanently red."
 *
 * Both halves matter. Configuring a rule is not evidence it fires — a typo in a
 * selector, a glob that does not match, or a plugin that failed to load all
 * produce a config that looks strict and reports nothing. This runs the real
 * ESLint against real fixtures using the repo's real `.eslintrc.json`.
 *
 * ⚠ `ignore: false` IS REQUIRED. The fixtures are in `.eslintignore` so
 * `next lint` skips them. Without this flag ESLint returns zero messages for an
 * ignored path — and zero messages is exactly what a passing assertion looks
 * like. That is the check-that-cannot-fail in its purest form, so the first
 * test below asserts the fixtures produce errors at all before any test asserts
 * WHICH errors.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'

// ⚠ THIS SUITE IS LEGITIMATELY SLOW AND MUST NOT INHERIT THE 30s DEFAULT.
// It constructs a real ESLint instance against the repo's own config and lints
// real files — across ~700 models' worth of project, that is tens of seconds on
// an idle machine and more when other sessions are building. Measured at 34.7s
// under load, which timed out and reported as a FAILED positive control: the
// most misleading possible red, because it names the check that exists to prove
// the others are meaningful.
//
// Raising the ceiling rather than trimming the work: the work is the test.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })
import { ESLint } from 'eslint'
import path from 'node:path'

const FIXTURES = path.resolve(process.cwd(), '__tests__/commissioner-os/eslint-fixtures')

const fixture = (name: string) => path.join(FIXTURES, name)

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({
    cwd: process.cwd(),
    // The repo's own config — not an inline one. A test that supplies its own
    // rules proves the rules work and says nothing about whether the repo has
    // them switched on.
    useEslintrc: true,
    ignore: false,
  })
})

async function lint(name: string) {
  const results = await eslint.lintFiles([fixture(name)])
  return results.flatMap((r) => r.messages)
}

const rulesIn = (messages: Awaited<ReturnType<typeof lint>>) =>
  messages.map((m) => m.ruleId).filter(Boolean) as string[]

describe('T-005 · the ESLint boundary actually fires', () => {
  it('the fixtures are reachable and produce errors (positive control)', async () => {
    // Before asserting which rules fire, assert that ANY do. If `ignore: false`
    // were dropped, or the fixture glob in .eslintrc.json stopped matching,
    // every specific assertion below would pass against an empty message list.
    const messages = await lint('prisma-import.ts')
    expect(messages.length).toBeGreaterThan(0)
  })

  it('bans @prisma/client and @/lib/prisma value imports', async () => {
    const messages = await lint('prisma-import.ts')
    expect(rulesIn(messages)).toContain('@typescript-eslint/no-restricted-imports')
    // Both imports, not just the first — a rule that stops at one report would
    // let the second form through unnoticed.
    expect(
      messages.filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports'),
    ).toHaveLength(2)
  })

  it('bans the RELATIVE import form too', async () => {
    // The form a `from '@/lib/prisma'`-only ban misses. The root CLAUDE.md
    // records four separate occasions in this repo where that exact census gave
    // the wrong answer; this is the rule not being the fifth.
    const messages = await lint('relative-prisma-import.ts')
    expect(rulesIn(messages)).toContain('@typescript-eslint/no-restricted-imports')
  })

  it('does NOT ban a type-only import', async () => {
    // `import type` erases at compile time and creates no runtime dependency.
    // Banning it would force a hand-written duplicate of a generated type and
    // teach people the rule is dumb, which is how rules get disabled.
    const messages = await lint('type-import-allowed.ts')
    expect(rulesIn(messages)).not.toContain('@typescript-eslint/no-restricted-imports')
  })

  it('bans all four raw SQL methods', async () => {
    const messages = await lint('raw-sql.ts')
    const raw = messages.filter((m) => m.ruleId === 'no-restricted-syntax')
    // Four, not "at least one": the $queryRawUnsafe / $executeRawUnsafe pair is
    // the dangerous half and the easy half to leave out of a regex.
    expect(raw).toHaveLength(4)
  })

  it('bans deleteMany and hard delete on a prisma/tx receiver', async () => {
    const messages = await lint('hard-delete.ts')
    const flagged = messages.filter((m) => m.ruleId === 'no-restricted-syntax')
    expect(flagged).toHaveLength(3)
    expect(flagged.some((m) => m.message.includes('deleteMany'))).toBe(true)
  })

  it('bans findUnique and findUniqueOrThrow', async () => {
    // T-006. Structurally unfilterable by the soft-delete extension, so the
    // only available answer is a ban. Broader than HANDOFF.md's "for
    // soft-deletable models" because ESLint cannot know which model a call
    // refers to — and a rule that silently misses the calls that matter is
    // worse than one that is too broad.
    const messages = await lint('find-unique.ts')
    const flagged = messages.filter((m) => m.ruleId === 'no-restricted-syntax')
    expect(flagged).toHaveLength(2)
  })

  it('does NOT flag Map/Set .delete()', async () => {
    // Ordinary JavaScript, and already present on this surface
    // (lib/commissioner-os/platform/eventBus.ts calls set.delete(listener)).
    // A property-only selector would flag it, the rule would be called noisy,
    // and a noisy rule gets removed — which is the real failure mode.
    const messages = await lint('set-delete-allowed.ts')
    expect(rulesIn(messages)).not.toContain('no-restricted-syntax')
  })
})

describe('T-005 · the boundary is inert outside its scope', () => {
  it('lib/domain/db.ts may use raw SQL', async () => {
    // withTenant's set_config() is necessarily raw: SET LOCAL cannot take a
    // bind parameter. Exempted by filename, not by directory, so a raw call in
    // any other domain module is still reported.
    const results = await eslint.lintFiles([path.resolve(process.cwd(), 'lib/domain/db.ts')])
    const raw = results.flatMap((r) => r.messages).filter((m) => m.ruleId === 'no-restricted-syntax')
    expect(raw).toEqual([])
  })

  it('does not touch AllFantasy files outside the Commissioner OS surface', async () => {
    // The scoping decision, asserted rather than asserted-about. lib/prisma.ts
    // is the singleton the whole 2,250-file codebase imports; if the globs were
    // wrong this is where it would show.
    const results = await eslint.lintFiles([path.resolve(process.cwd(), 'lib/prisma.ts')])
    const ours = results
      .flatMap((r) => r.messages)
      .filter(
        (m) =>
          m.ruleId === 'no-restricted-syntax' ||
          m.ruleId === '@typescript-eslint/no-restricted-imports',
      )
    expect(ours).toEqual([])
  })
})

describe('T-005 · the migration debt is bounded and countable', () => {
  it('the three pre-existing importers are exempt, and only those three', async () => {
    // They cannot move until a tenant id can be resolved (T-101 + T-102). They
    // are listed individually in .eslintrc.json rather than by directory, so a
    // FOURTH cannot appear without editing that file and explaining itself.
    const exempt = [
      'lib/commissioner-os/decision-os-client/live.ts',
      'lib/commissioner-os/managers/decision-os-client/live.ts',
      'lib/commissioner-os/resolveActiveLeagueId.ts',
    ]
    const results = await eslint.lintFiles(exempt.map((f) => path.resolve(process.cwd(), f)))
    const flagged = results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports')
    expect(flagged).toEqual([])
  })

  it('the rest of the surface is already clean', async () => {
    // If this goes red, someone added a fourth importer. That is the ratchet.
    const results = await eslint.lintFiles([
      path.resolve(process.cwd(), 'lib/commissioner-os'),
      path.resolve(process.cwd(), 'app/commissioner-os'),
    ])
    const flagged = results
      .flatMap((r) => ({ file: r.filePath, messages: r.messages }))
      .flatMap(({ file, messages }) =>
        messages
          .filter(
            (m) =>
              m.ruleId === 'no-restricted-syntax' ||
              m.ruleId === '@typescript-eslint/no-restricted-imports',
          )
          .map((m) => `${path.relative(process.cwd(), file)}:${m.line} ${m.ruleId}`),
      )
    expect(flagged).toEqual([])
  })
})
