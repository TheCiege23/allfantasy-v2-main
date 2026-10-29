import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { AF_BLUE, afAdpCellTitle } from '@/lib/draft-room/adpReadinessCopy'
import { sortValueForKey, defaultSortDirectionForKey } from '@/components/app/draft-room/SleeperPoolSort'
import { buildSleeperPoolTableLayout } from '@/lib/draft-room/sleeperPoolTableLayout'

const tableSrc = readFileSync(resolve(__dirname, '..', '..', 'components/app/draft-room/SleeperPoolTable.tsx'), 'utf8')

describe('AF ADP column', () => {
  it('sits beside market ADP as the second of exactly two ADP columns', () => {
    const keys = buildSleeperPoolTableLayout('NBA').columns.map((c) => c.key)
    expect(keys.slice(2, 4)).toEqual(['adp', 'afAdp'])
    expect(keys.filter((k) => /adp/i.test(k))).toEqual(['adp', 'afAdp'])
  })

  it('renders in AF Blue — header and value both', () => {
    expect(AF_BLUE).toBe('var(--af-blue, #3b82f6)')
    expect(tableSrc).toMatch(/-af-adp`\}[\s\S]{0,600}color: AF_BLUE/)
    expect(tableSrc).toMatch(/col\.key === 'afAdp' \? \{ color: AF_BLUE \}/)
  })

  it('sorts ascending on the AF ADP value, with no fallback to market ADP', () => {
    expect(defaultSortDirectionForKey('afAdp')).toBe('asc')
    expect(sortValueForKey({ name: 'A', adp: 10, afAdp: 12.5 }, 'afAdp')).toBe(12.5)
    expect(sortValueForKey({ name: 'B', adp: 10, afAdp: null }, 'afAdp')).toBeNull()
  })

  it('explains what went into the number', () => {
    const t = afAdpCellTitle({
      hasValue: true,
      contributions: { market: 0.5, imported: 0.3, af: 0.2 },
      importedSampleSize: 140,
      ownSampleSize: 22,
    })
    expect(t).toContain('market 50%')
    expect(t).toContain('imported leagues 30% (140 drafts)')
    expect(t).toContain('AllFantasy leagues 20% (22 drafts)')
  })

  it('omits a source that contributed nothing, and says so when there is no value', () => {
    const marketOnly = afAdpCellTitle({ hasValue: true, contributions: { market: 1, imported: 0, af: 0 } })
    const breakdown = marketOnly.split('This number:')[1] ?? ''
    expect(breakdown).toContain('market 100%')
    expect(breakdown).not.toContain('imported leagues')
    expect(afAdpCellTitle({ hasValue: false })).toMatch(/No market ADP or completed drafts/)
  })
})
