/**
 * A kept player is taken from the first pick of the draft, not from the round his keeper slot comes
 * up. The draft room built its "already drafted" sets from picks made only, so a keeper costing round
 * 10 sat in the available list, the queue and the pick suggestions through nine rounds.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')

describe('the draft room treats keeper locks as taken', () => {
  it('reads the locks off the session snapshot', () => {
    expect(src).toMatch(/^\s*const keeperLocks = \(session as DraftSessionSnapshot \| null\)\?\.keeper\?\.locks$/m)
  })
  it('both taken sets (by name and by id) include picks made and keeper locks', () => {
    const merged = src.match(/\[\.\.\.\(session\?\.picks \?\? \[\]\), \.\.\.\(keeperLocks \?\? \[\]\)\]/g) ?? []
    expect(merged).toHaveLength(2)
    expect(src).toMatch(/^\s*\[session\?\.picks, keeperLocks\],$/m)
    expect(src).toMatch(/^\s*\}, \[session\?\.picks, keeperLocks\]\)$/m)
  })
})
