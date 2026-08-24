/**
 * `git diff -U0` hunk parsing for the db-first guard's changed-mode line scoping.
 *
 * SEPARATE MODULE ON PURPOSE, for two reasons:
 *   1. It is pure. No exec, no fs, no repository needed to test the arithmetic.
 *   2. `check-db-first-api-boundary.mjs` opens with a `#!/usr/bin/env node` shebang, and vitest's
 *      transform hoists its import rewrites above line 1 — which lands them in front of the
 *      shebang and fails to parse. Importing THIS file instead sidesteps that without stripping a
 *      shebang the CLI is entitled to have.
 *
 * WHY LINE SCOPING EXISTS AT ALL. The guard's job is "do not ADD a violation". Reporting whole
 * files meant editing one unrelated line in `lib/sports-router.ts` inherited its four pre-existing
 * TheSportsDB calls, and the only ways out were to fix architecture you did not come to fix, or to
 * paste `db-first-exception` onto lines you did not write. The second is what actually happens,
 * and it hollows out that marker for everyone — it is reserved for a TEMPORARY violation with a
 * migration plan, and once it means "the guard was in my way" it means nothing.
 *
 * Measured on the ESPN host swap: 10 whole-file violations, ZERO introduced by the change.
 *
 * ⚠ An off-by-one here fails SILENTLY and in the dangerous direction — a line drops out of the
 * scanned set and a genuinely new provider call goes unreported, with nothing turning red. That is
 * why __tests__/db-first-guard-line-scoping.test.ts pins the hunk arithmetic case by case.
 */

/**
 * Parse `git diff -U0` output into the set of post-change line numbers touched per file.
 *
 * @param {string} output raw `git diff -U0` text
 * @returns {Map<string, Set<number>>} keyed by repo-relative path
 */
export function parseChangedLineNumbers(output) {
  const byFile = new Map()
  let current = null

  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim()
      // A deletion targets /dev/null: there is no post-change file to scan.
      current = target === '/dev/null' ? null : target.replace(/^b\//, '')
      if (current) byFile.set(current, new Set())
      continue
    }

    // @@ -old,len +new,len @@ — the `+` side is post-change numbering, which is what the scanner
    // reports against. git OMITS `,len` when the hunk is a single line, so an absent count means
    // one, never zero.
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!hunk || !current) continue

    const start = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    const set = byFile.get(current)
    for (let i = 0; i < count; i += 1) set.add(start + i)
  }

  return byFile
}
