/**
 * `git diff -U0` hunk arithmetic for the db-first guard's changed-mode line scoping.
 *
 * WHY THIS IS TESTED AND THE REST OF THE GUARD IS NOT. Line scoping decides which lines get
 * scanned at all, and an off-by-one here fails SILENTLY in the dangerous direction: a line drops
 * out of the scanned set and a genuinely new provider call goes unreported. Nothing turns red.
 * Every other rule in that guard fails loudly when it is wrong.
 *
 * The parser is split from the `execSync` deliberately so these cases need no repository.
 */
import { describe, it, expect } from 'vitest'

import { parseChangedLineNumbers } from '../scripts/db-first-diff-lines.mjs'

/** `git diff -U0` emits no context lines, so every hunk range is exactly the changed span. */
const diff = (body: string) => body.trimStart()

describe('parseChangedLineNumbers', () => {
  it('reads a single-line hunk, where git omits the count', () => {
    // `@@ -10 +10 @@` — no `,count`. Treating the absent count as 0 would scan nothing.
    const out = parseChangedLineNumbers(diff(`
--- a/lib/x.ts
+++ b/lib/x.ts
@@ -10 +10 @@
-old
+new
`))
    expect([...out.get('lib/x.ts')!]).toEqual([10])
  })

  it('expands a multi-line hunk across its full span', () => {
    const out = parseChangedLineNumbers(diff(`
--- a/lib/x.ts
+++ b/lib/x.ts
@@ -5,2 +5,3 @@
+a
+b
+c
`))
    expect([...out.get('lib/x.ts')!]).toEqual([5, 6, 7])
  })

  it('unions multiple hunks in one file', () => {
    const out = parseChangedLineNumbers(diff(`
--- a/lib/x.ts
+++ b/lib/x.ts
@@ -3 +3 @@
+one
@@ -40,2 +41,2 @@
+two
+three
`))
    expect([...out.get('lib/x.ts')!].sort((a, b) => a - b)).toEqual([3, 41, 42])
  })

  it('keeps files separate', () => {
    const out = parseChangedLineNumbers(diff(`
--- a/lib/a.ts
+++ b/lib/a.ts
@@ -1 +1 @@
+x
--- a/lib/b.ts
+++ b/lib/b.ts
@@ -99 +99 @@
+y
`))
    expect([...out.get('lib/a.ts')!]).toEqual([1])
    expect([...out.get('lib/b.ts')!]).toEqual([99])
    expect(out.size).toBe(2)
  })

  it('strips the b/ prefix so paths match the scanner', () => {
    // The scanner reports repo-relative paths. Leaving `b/` on would make every lookup miss, and
    // a miss means an empty Set — which scans nothing and reports no violations.
    const out = parseChangedLineNumbers(diff(`
--- a/app/api/x/route.ts
+++ b/app/api/x/route.ts
@@ -2 +2 @@
+z
`))
    expect(out.has('app/api/x/route.ts')).toBe(true)
    expect(out.has('b/app/api/x/route.ts')).toBe(false)
  })

  it('ignores a deletion target of /dev/null', () => {
    const out = parseChangedLineNumbers(diff(`
--- a/lib/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-a
-b
-c
`))
    expect(out.size).toBe(0)
  })

  it('covers every line of a newly added file', () => {
    // A new file is one hunk starting at 1 — the whole file is "changed", which is what makes a
    // new provider call in a brand-new file impossible to slip past.
    const out = parseChangedLineNumbers(diff(`
--- /dev/null
+++ b/lib/new.ts
@@ -0,0 +1,4 @@
+a
+b
+c
+d
`))
    expect([...out.get('lib/new.ts')!]).toEqual([1, 2, 3, 4])
  })

  it('returns an empty map for an empty diff rather than throwing', () => {
    expect(parseChangedLineNumbers('').size).toBe(0)
  })
})
