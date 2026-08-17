/**
 * The build script must not shrink a heap ceiling the platform already set.
 *
 * Node accepts both `--max-old-space-size` and `--max_old_space_size`. Vercel's larger build
 * machines set the UNDERSCORE form ambiently (observed: `--max_old_space_size=14979` on an
 * 8-core/16 GB box). The guard only matched hyphens, so it missed that, appended its own
 * hyphenated `6144`, and Node applied the LAST flag — capping a 16 GB machine at 6 GB. The
 * build then died with FatalProcessOutOfMemory → SIGABRT at ~5.2 GB, and the override
 * comment ("an explicit NODE_OPTIONS heap flag wins") described the opposite of the behaviour.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(process.cwd(), "scripts/vercel-next-build.cjs"), "utf-8")

/** Mirror of the helper in the build script, exercised directly. */
function hasExplicitHeapFlag(nodeOptions: string | undefined | null): boolean {
  return /--max[-_]old[-_]space[-_]size=/.test(nodeOptions ?? "")
}

describe("heap-flag detection accepts both spellings Node accepts", () => {
  it("detects the UNDERSCORE form Vercel actually sets — the missed case", () => {
    expect(hasExplicitHeapFlag("--max_old_space_size=14979")).toBe(true)
  })

  it("detects the hyphenated form", () => {
    expect(hasExplicitHeapFlag("--max-old-space-size=8192")).toBe(true)
  })

  it("detects either spelling among other options", () => {
    expect(hasExplicitHeapFlag("--enable-source-maps --max_old_space_size=9000")).toBe(true)
    expect(hasExplicitHeapFlag("--enable-source-maps --max-old-space-size=9000")).toBe(true)
  })

  it("reports absent when nothing pins the heap", () => {
    for (const v of ["", undefined, null, "--enable-source-maps", "--max-semi-space-size=64"]) {
      expect(hasExplicitHeapFlag(v)).toBe(false)
    }
  })
})

describe("the build script uses the shared guard at every site", () => {
  it("defines the both-spellings helper", () => {
    expect(source).toMatch(/function hasExplicitHeapFlag/)
    expect(source).toMatch(/--max\[-_\]old\[-_\]space\[-_\]size=/)
  })

  it("no site still does a hyphen-only substring check", () => {
    // The exact expression that caused the OOM.
    expect(source).not.toContain("NODE_OPTIONS?.includes('--max-old-space-size=')")
  })

  it("both spawn sites route through the helper", () => {
    const uses = source.match(/hasExplicitHeapFlag\(process\.env\.NODE_OPTIONS\)/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(2)
  })
})
