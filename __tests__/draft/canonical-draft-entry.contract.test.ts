/**
 * Phase 5D — league draft entry points prefer the canonical `/drafts/[draftSessionId]` URL
 * and must not silently route live snake to legacy DraftShell-only paths.
 *
 * Static source reads only (no DB).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Canonical draft entry URLs', () => {
  it('league draft page upserts DraftSession and redirects to /drafts/', () => {
    const src = read('app/league/[leagueId]/draft/page.tsx')
    expect(src).toMatch(/redirect\(`\/drafts\/\$\{ds\.id\}`\)/)
    expect(src).toMatch(/prisma\.draftSession\.upsert/)
  })

  it('draft room page redirects live context to /drafts/', () => {
    const src = read('app/draft/room/[draftId]/page.tsx')
    expect(src).toMatch(/redirect\(`\/drafts\/\$\{encodeURIComponent\(context\.draftId\)\}`\)/)
  })

  it('draft id router sends live snake to /drafts/', () => {
    const src = read('app/draft/[draftId]/page.tsx')
    expect(src).toMatch(/redirect\(`\/drafts\/\$\{encodeURIComponent\(context\.draftId\)\}`\)/)
  })

  it('DraftBoard live branch renders DraftRoomPageClient (canonical client)', () => {
    const src = read('components/draft/DraftBoard.tsx')
    expect(src).toMatch(/DraftRoomPageClient/)
    expect(src).toMatch(/props\.kind === 'mock'/)
  })
})
