import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 🛑 NO BROWSER CODE TALKS TO A GIF SERVICE DIRECTLY. Three chat screens did: the bracket pool chat
 * called Tenor with a key inlined into the page, and the league chat panel and Messages ran the
 * shared `searchGifs` client-side, trying the dead Tenor API before every result. Browser code goes
 * through /api/chat/gifs (lib/rich-message/gifSearchClient.ts); only the server holds GIF keys.
 *
 * Scans CODE lines, not comments — a file explaining why it does not call something must not be
 * reported for calling it (the lesson recorded in push-optin-reachable.test.ts).
 */

const REPO = process.cwd()

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')
}

function clientFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      clientFiles(rel, out)
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      const src = readFileSync(join(REPO, rel), 'utf8')
      if (/^\s*['"]use client['"]/m.test(src)) out.push(rel)
    }
  }
  return out
}

describe('GIF search stays on the server', () => {
  const files = [...clientFiles('components'), ...clientFiles('app')]

  it('finds the client components it is meant to police', () => {
    // A scan that finds nothing proves nothing.
    expect(files).toContain('components/bracket/PoolChat.tsx')
    expect(files).toContain('components/chat/LeagueChatPanel.tsx')
    expect(files.length).toBeGreaterThan(50)
  })

  it('no client component calls a GIF service or the shared server-side search', () => {
    const offenders = files.filter((f) => {
      const code = stripComments(readFileSync(join(REPO, f), 'utf8'))
      return /tenor\.googleapis\.com|api\.giphy\.com|api\.klipy\.(com|ai)|NEXT_PUBLIC_TENOR_API_KEY|\bsearchGifs\s*\(/.test(code)
    })
    expect(offenders).toEqual([])
  })
})
