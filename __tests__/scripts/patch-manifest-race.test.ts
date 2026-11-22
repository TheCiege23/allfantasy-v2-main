// @vitest-environment node
/**
 * scripts/patch-manifest-race.cjs must actually patch the Next.js it is installed with.
 * It skipped silently for a whole Next 15.5 release line because `"utf8"` became `'utf8'`;
 * the first case below runs it against the real installed plugin so the next shape change
 * fails here instead of printing a warning nobody reads.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { patchManifestRace } = require('../../scripts/patch-manifest-race.cjs') as {
  patchManifestRace: (root: string) => string
}

const PLUGIN_REL = path.join('node_modules', 'next', 'dist', 'build', 'webpack', 'plugins', 'pages-manifest-plugin.js')
const MARKER = '__AF_MANIFEST_LOCK_PATCH__'

const roots: string[] = []
function fakeRepo(pluginSource: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'af-manifest-patch-'))
  roots.push(root)
  fs.mkdirSync(path.dirname(path.join(root, PLUGIN_REL)), { recursive: true })
  fs.writeFileSync(path.join(root, PLUGIN_REL), pluginSource)
  return root
}
const read = (root: string) => fs.readFileSync(path.join(root, PLUGIN_REL), 'utf8')

afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

const realPlugin = fs.readFileSync(path.join(process.cwd(), PLUGIN_REL), 'utf8')

describe('patchManifestRace', () => {
  it('patches the installed Next.js plugin, and the result still compiles', () => {
    const root = fakeRepo(realPlugin)
    // CI's `npm ci` runs this script in postinstall, so the installed copy may already carry the
    // patch. Either way it must end up patched; a changed upstream shape returns
    // 'skipped-shape-changed' and fails here.
    expect(['patched', 'already-current']).toContain(patchManifestRace(root))
    const patched = read(root)
    expect(patched).toContain(MARKER)
    expect(() => new vm.Script(patched)).not.toThrow()
  })

  it('is idempotent', () => {
    const root = fakeRepo(realPlugin)
    patchManifestRace(root)
    const once = read(root)
    expect(patchManifestRace(root)).toBe('already-current')
    expect(read(root)).toBe(once)
  })

  it('accepts both quote styles of the original', () => {
    const block = (q: string) =>
      `        const writeMergedManifest = async (manifestPath, entries)=>{\n            await _promises.default.mkdir(_path.default.dirname(manifestPath), {\n                recursive: true\n            });\n            await _promises.default.writeFile(manifestPath, JSON.stringify({\n                ...await _promises.default.readFile(manifestPath, ${q}utf8${q}).then((res)=>JSON.parse(res)).catch(()=>({})),\n                ...entries\n            }, null, 2));\n        };`
    for (const q of ['"', "'"]) {
      const root = fakeRepo(`x;\n${block(q)}\ny;`)
      expect(patchManifestRace(root)).toBe('patched')
      expect(read(root)).toContain(MARKER)
    }
  })

  it('leaves an unknown shape untouched and says so', () => {
    const root = fakeRepo('const writeMergedManifest = somethingElse;')
    expect(patchManifestRace(root)).toBe('skipped-shape-changed')
    expect(read(root)).toBe('const writeMergedManifest = somethingElse;')
  })

  it('reports a missing plugin', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'af-manifest-patch-'))
    roots.push(root)
    expect(patchManifestRace(root)).toBe('skipped-missing')
  })
})
