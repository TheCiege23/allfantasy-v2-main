import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

/*
 * ⚠ THIS FIXTURE ONLY BUILT HALF OF WHAT THE SCRIPT DOES, AND HAD BEEN RED EVER
 * SINCE THE OTHER HALF WAS ADDED.
 *
 * railway-patch-app-build-manifest.cjs does two things: it injects the built CSS
 * into app-build-manifest.json, and then it repairs the App Router client
 * reference manifests — which are what Next actually reads at request time to
 * emit <link rel="stylesheet"> tags. The fixture created only
 * `.next/app-build-manifest.json` and `.next/static/css`, so the second half hit
 *     [railway-patch-manifest] no client reference manifests under <dist>/server/app
 * and exited 1. execSync then threw, and the test failed BEFORE reaching its own
 * assertion.
 *
 * Measured: the assertion it never reached would have passed. Running the script
 * against the old fixture writes `static/css/abc123.css` into /layout correctly
 * and only then exits non-zero. So the script was right and the fixture was
 * incomplete — the exit(1) is deliberate, because a build with no client
 * reference manifests ships HTML with no stylesheet links, which is the whole
 * failure this script exists to prevent.
 *
 * (The error text reads `<dist>\.next/server/app` on Windows, which looks like a
 * separator bug and is not: that string is cosmetic, built from the env var plus
 * a literal. The real lookup is path.join'd.)
 *
 * The fixture now supplies both halves, so the second half is under test rather
 * than merely tripping the first.
 */

const CSS_ASSET = 'static/css/abc123.css'

/** Writes a file shaped like a real Next `*_client-reference-manifest.js`. */
function writeClientReferenceManifest(filePath: string, entryCSSFiles: Record<string, string[]>) {
  const payload = {
    moduleLoading: { prefix: '/_next/', crossOrigin: null },
    ssrModuleMapping: {},
    edgeSSRModuleMapping: {},
    clientModules: {},
    entryCSSFiles,
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  // Prefix and the missing trailing semicolon both copied from a real emitted
  // manifest, so the script's own payload regex is exercised as it ships.
  fs.writeFileSync(
    filePath,
    'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});' +
      `globalThis.__RSC_MANIFEST["/page"]=${JSON.stringify(payload)}`,
  )
}

/** Reads one back, failing loudly if the patch left it unparseable. */
function readClientReferenceManifest(filePath: string): Record<string, string[]> {
  const source = fs.readFileSync(filePath, 'utf8')
  const match = source.match(/^(.*?globalThis\.__RSC_MANIFEST\["(?:\\.|[^"\\])+"\]=)(\{.*\})(;?)$/s)
  if (!match) throw new Error(`patched manifest no longer parses: ${filePath}`)
  return (JSON.parse(match[2]).entryCSSFiles ?? {}) as Record<string, string[]>
}

describe('railway patch app-build-manifest', () => {
  it('injects CSS into /layout and into the client reference manifests', () => {
    const fixtureRoot = path.join(process.cwd(), '.tmp-railway-manifest-fixture')
    const distDir = path.join(fixtureRoot, '.next')
    const cssDir = path.join(distDir, 'static', 'css')
    const manifestPath = path.join(distDir, 'app-build-manifest.json')
    const serverAppDir = path.join(distDir, 'server', 'app')

    const explicitManifest = path.join(serverAppDir, 'page_client-reference-manifest.js')
    const inferredManifest = path.join(serverAppDir, 'dashboard', 'page_client-reference-manifest.js')

    /*
     * Next writes these keys as ABSOLUTE, platform-separated paths — on Windows
     * "C:\\repo\\app\\layout", on Linux "/repo/app/layout". The two files below
     * use different separator styles on purpose:
     *
     *   explicit — native separators, so isRootLayoutEntry's [\\/] class is
     *              exercised against whatever platform the suite runs on.
     *   inferred — POSIX separators, because that branch REBUILDS the key. On a
     *              backslash key inferRootLayoutEntry joins a forward-slash
     *              prefix to backslash segments and yields a mixed path, so
     *              pinning an exact key there would encode a Windows-only quirk.
     *              Railway (where this script runs) is Linux, and this is the
     *              shape it sees.
     */
    const nativeLayoutEntry = path.join(fixtureRoot, 'app', 'layout')
    const nativePageEntry = path.join(fixtureRoot, 'app', 'page')
    const posixPageEntry = '/srv/app/page'
    const posixLayoutEntry = '/srv/app/layout'

    fs.rmSync(fixtureRoot, { recursive: true, force: true })
    try {
      fs.mkdirSync(cssDir, { recursive: true })
      fs.writeFileSync(path.join(cssDir, 'abc123.css'), 'body{color:red}')
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            pages: {
              '/layout': [
                'static/chunks/webpack.js',
                'static/chunks/main-app.js',
                'static/chunks/app/layout.js',
              ],
            },
          },
          null,
          2,
        ),
      )

      // Has a root-layout entry already, but with no CSS attached — the exact
      // state the script exists to repair.
      writeClientReferenceManifest(explicitManifest, {
        [nativeLayoutEntry]: [],
        [nativePageEntry]: [],
      })
      // Has NO root-layout entry, so the key has to be inferred from a sibling.
      writeClientReferenceManifest(inferredManifest, { [posixPageEntry]: [] })

      execSync('node scripts/railway-patch-app-build-manifest.cjs', {
        cwd: process.cwd(),
        env: { ...process.env, AF_NEXT_DIST_DIR: path.relative(process.cwd(), distDir) },
        stdio: 'pipe',
      })

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      expect(manifest.pages['/layout']).toContain(CSS_ASSET)

      // The existing root-layout entry is filled in...
      const explicitEntries = readClientReferenceManifest(explicitManifest)
      expect(explicitEntries[nativeLayoutEntry]).toContain(CSS_ASSET)
      // ...and a sibling that was never a layout is left alone.
      expect(explicitEntries[nativePageEntry]).toEqual([])

      // ...and a missing root-layout entry is inferred and created.
      const inferredEntries = readClientReferenceManifest(inferredManifest)
      expect(Object.keys(inferredEntries)).toContain(posixLayoutEntry)
      expect(inferredEntries[posixLayoutEntry]).toContain(CSS_ASSET)
    } finally {
      /*
       * ⚠ IN A `finally` BECAUSE IT WAS NOT. Cleanup used to sit after the last
       * assertion, so every failing run left .tmp-railway-manifest-fixture in the
       * repo root — and this test has been failing for months. One was still
       * there when this was written. It is gitignored by `.tmp-*`, so it never
       * showed up in git status to prompt anyone.
       */
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  /*
   * Pins the exit(1) that the old fixture tripped over, so the next reader does
   * not "fix" this suite by softening it. A build that emits CSS but no client
   * reference manifests serves HTML with no <link rel="stylesheet"> — failing
   * the build is the point, because the alternative is shipping a bare site and
   * finding out from a user.
   */
  it('fails the build when there are no client reference manifests to repair', () => {
    const fixtureRoot = path.join(process.cwd(), '.tmp-railway-manifest-missing-crm')
    const distDir = path.join(fixtureRoot, '.next')
    const cssDir = path.join(distDir, 'static', 'css')

    fs.rmSync(fixtureRoot, { recursive: true, force: true })
    try {
      fs.mkdirSync(cssDir, { recursive: true })
      fs.writeFileSync(path.join(cssDir, 'abc123.css'), 'body{color:red}')
      fs.writeFileSync(
        path.join(distDir, 'app-build-manifest.json'),
        JSON.stringify({ pages: { '/layout': ['static/chunks/app/layout.js'] } }, null, 2),
      )
      // Deliberately no .next/server/app.

      let failed = false
      let stderr = ''
      try {
        execSync('node scripts/railway-patch-app-build-manifest.cjs', {
          cwd: process.cwd(),
          env: { ...process.env, AF_NEXT_DIST_DIR: path.relative(process.cwd(), distDir) },
          stdio: 'pipe',
        })
      } catch (error) {
        failed = true
        stderr = String((error as { stderr?: Buffer }).stderr ?? '')
      }

      expect(failed, 'script must exit non-zero when no client reference manifests exist').toBe(true)
      expect(stderr).toContain('no client reference manifests')
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
