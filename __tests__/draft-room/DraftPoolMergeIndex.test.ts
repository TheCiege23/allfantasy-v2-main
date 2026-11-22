import { describe, expect, it } from 'vitest'
import { DraftPoolMergeIndex, type DraftPoolMergeIdentity } from '@/lib/draft-room/DraftPoolMergeIndex'

const identity = (name: string, position = '', team = '', looseName = name): DraftPoolMergeIdentity => ({ name, position, team, looseName })
const reference = (rows: DraftPoolMergeIdentity[], q: DraftPoolMergeIdentity) => rows.findIndex(row =>
  (!q.position || !row.position || q.position === row.position) &&
  (!q.team || !row.team || q.team === row.team) &&
  (row.name === q.name || Boolean(q.looseName && row.looseName === q.looseName)),
)

describe('indexed draft pool merge preserves player identity matches', () => {
  it('chooses the first compatible row across both matching tiers', () => {
    const index = new DraftPoolMergeIndex()
    index.upsert(0, identity('other spelling', 'wr', 'min', 'same person'))
    index.upsert(1, identity('exact spelling', 'wr', 'min', 'same person'))
    expect(index.find(identity('exact spelling', 'wr', 'min', 'same person'))).toBe(0)
    expect(index.find(identity('exact spelling', 'rb', 'min', 'same person'))).toBe(-1)
    expect(index.find(identity('exact spelling', 'wr', 'sea', 'same person'))).toBe(-1)
  })
  it('refreshes a blank team after enrichment and indexes appended players', () => {
    const index = new DraftPoolMergeIndex()
    index.upsert(0, identity('athlete', 'wr'))
    expect(index.find(identity('athlete', 'wr', 'min'))).toBe(0)
    index.upsert(0, identity('athlete', 'wr', 'min'))
    expect(index.find(identity('athlete', 'wr', 'sea'))).toBe(-1)
    index.upsert(1, identity('another athlete', 'qb', 'sea'))
    expect(index.find(identity('another athlete', 'qb', 'sea'))).toBe(1)
    expect(index.find(identity('athlete'))).toBe(0)
  })
  it('does not cross canonical and loose namespaces or merge generational names', () => {
    const index = new DraftPoolMergeIndex()
    index.upsert(0, identity('marvin harrison jr', 'wr', 'ari'))
    index.upsert(1, identity('canonical name', 'wr', 'ari', 'loose name'))
    expect(index.find(identity('marvin harrison', 'wr', 'ari'))).toBe(-1)
    expect(index.find(identity('loose name', 'wr', 'ari', 'unrelated'))).toBe(-1)
    expect(index.find(identity('canonical name', 'wr', 'ari', ''))).toBe(1)
  })
  it('agrees with the former full scan across mixed names, positions, wildcard teams and updates', () => {
    const rows: DraftPoolMergeIdentity[] = []
    const index = new DraftPoolMergeIndex()
    let seed = 37
    const random = (size: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % size }
    for (let n = 0; n < 500; n++) {
      const q = identity('name' + random(32), ['', 'qb', 'wr', 'c', 'sp'][random(5)], ['', 'bos', 'min', 'sea'][random(4)], 'loose' + random(29))
      const expected = reference(rows, q)
      expect(index.find(q)).toBe(expected)
      if (expected >= 0) {
        const updated = { ...rows[expected], team: rows[expected].team || q.team }
        rows[expected] = updated
        index.upsert(expected, updated)
      } else {
        rows.push(q)
        index.upsert(rows.length - 1, q)
      }
    }
  })
})
