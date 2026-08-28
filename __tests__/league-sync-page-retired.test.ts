/**
 * `/leagues/sync` is retired.
 *
 * It was a SECOND import pipeline: its own add-and-sync modal and discovery panel
 * drove the older `/api/league/*` endpoints, while `/import` drives
 * `/api/leagues/import/*` — and only that one applies the commissioner gate, the
 * attestation step and the team claim.
 *
 * ⚠ IT DID NOT GO FOR FREE, and the cost is recorded rather than discovered
 * later: the per-league RE-SYNC button went with it. `/api/league/sync` and
 * `/api/league/sleeper-sync` still exist and still work; nothing in the UI calls
 * them, and sleeper-sync now has no caller at all. If re-sync wants a home again,
 * /core/sync already owns "is THIS league current".
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')

/**
 * Code with the comments taken out.
 *
 * ⚠ A LINE-START CHECK IS NOT GOOD ENOUGH, and the first version of this test
 * proved it: a multi-line comment's CONTINUATION lines start with whatever word
 * fell there, so two notes explaining the retirement were reported as live links.
 * Block state has to be tracked, not guessed at per line.
 */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  let inBlock = false
  let inLine = false
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (!inBlock && !inLine && two === '/*') { inBlock = true; i += 2; continue }
    if (inBlock && two === '*/') { inBlock = false; i += 2; continue }
    if (!inBlock && !inLine && two === '//') { inLine = true; i += 2; continue }
    if (inLine && src[i] === '\n') { inLine = false; out += '\n'; i += 1; continue }
    if (!inBlock && !inLine) out += src[i]
    i += 1
  }
  return out
}

/** Every .ts/.tsx under the app's source roots. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  const full = resolve(root, dir)
  if (!existsSync(full)) return out
  for (const entry of readdirSync(full)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const p = join(full, entry)
    if (statSync(p).isDirectory()) sourceFiles(join(dir, entry), out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(join(dir, entry))
  }
  return out
}

describe('⚠ the page and its component are gone', () => {
  it('has no route file', () => {
    expect(existsSync(resolve(root, 'app/leagues/sync/page.tsx'))).toBe(false)
  })

  it('has no component file', () => {
    expect(existsSync(resolve(root, 'app/components/LeagueSyncDashboard.tsx'))).toBe(false)
  })
})

describe('⚠ nothing still links to it', () => {
  it('leaves no live reference — every surviving mention is a comment', () => {
    /*
     * Asserted this way rather than "the string is absent", because the notes
     * explaining WHY it was retired necessarily name it. A comment is history; an
     * href is a broken link.
     */
    const offenders: string[] = []
    for (const rel of [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')]) {
      if (stripComments(read(rel)).includes('/leagues/sync')) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('drops the rail entry and its nav key', () => {
    const shell = read('components/core-app/AfCoreShell.tsx')
    expect(shell).not.toContain("{ key: 'league-sync'")
    expect(shell).not.toContain("| 'league-sync'")
    expect(shell).toContain('LEAGUE SYNC IS GONE FROM THE RAIL, AND FROM THE APP')
  })
})

describe('⚠ the "Sync & connect" button disappears rather than duplicating Import', () => {
  it('makes syncHref optional', () => {
    expect(read('components/core-app/screens/MyLeaguesV4.tsx')).toContain('syncHref?: string | null')
  })

  it('renders it only when there is somewhere to go', () => {
    // Pointing it at /import would put two buttons doing the same thing beside
    // one already labelled "Import more".
    expect(read('components/core-app/screens/MyLeaguesV4.tsx')).toContain('{syncHref ? (')
  })

  it('stops passing one from the pages that did', () => {
    expect(read('app/leagues/page.tsx')).not.toContain('syncHref=')
    expect(read('app/dev/leagues-preview/page.tsx')).not.toContain('syncHref=')
  })
})

describe('⚠ the capability that went with it is written down', () => {
  it('names re-sync as the loss, in the shell and in the module', () => {
    expect(read('components/core-app/AfCoreShell.tsx')).toContain(
      'WHAT WENT WITH IT: the per-league RE-SYNC BUTTON',
    )
    expect(read('lib/core-app/leagueSync.ts')).toContain('It does not re-sync')
  })

  it('says where re-sync could live if it is wanted back', () => {
    expect(read('components/core-app/AfCoreShell.tsx')).toContain('/core/sync already owns')
  })
})
