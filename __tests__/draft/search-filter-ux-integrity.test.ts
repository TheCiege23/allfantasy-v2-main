import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyDraftFilters,
  filterByPosition,
  type DraftPlayer,
} from '../../lib/draft-room/DraftPlayerSearchResolver'
import { isRookieEligibleForFilter } from '../../lib/draft-room/rookieFilterPredicate'

const root = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const POOL: DraftPlayer[] = [
  { name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 12.1 },
  { name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 15.4 },
  { name: 'Core Signal', position: 'QB', team: 'KC', adp: 21.2 },
  { name: 'Delta Edge', position: 'TE', team: 'SEA', adp: 25.3 },
  { name: 'Echo Guard', position: 'RB', team: 'MIA', adp: 31.8 },
]

function names(rows: DraftPlayer[]): string[] {
  return rows.map((r) => r.name)
}

function applyRookiesOnly<T extends DraftPlayer & { yearsExp?: number | null; isRookie?: boolean; isDevy?: boolean }>(
  rows: T[],
  rookiesOnly: boolean,
): T[] {
  if (!rookiesOnly) return rows
  return rows.filter((row) => isRookieEligibleForFilter(row, { devyEnabled: false, c2cEnabled: false }))
}

describe('Slice 4 — search and filter mechanics', () => {
  it('1. search filters by player name', () => {
    const out = applyDraftFilters(POOL, {
      searchQuery: 'Atlas',
      positionFilter: 'All',
      draftedNames: new Set(),
      showDrafted: true,
    })
    expect(names(out)).toEqual(['Atlas Runner'])
  })

  it('2. search is case-insensitive', () => {
    const out = applyDraftFilters(POOL, {
      searchQuery: 'atlas',
      positionFilter: 'All',
      draftedNames: new Set(),
      showDrafted: true,
    })
    expect(names(out)).toEqual(['Atlas Runner'])
  })

  it('3. search clear restores list', () => {
    const narrowed = applyDraftFilters(POOL, {
      searchQuery: 'Atlas',
      positionFilter: 'All',
      draftedNames: new Set(),
      showDrafted: true,
    })
    const restored = applyDraftFilters(POOL, {
      searchQuery: '',
      positionFilter: 'All',
      draftedNames: new Set(),
      showDrafted: true,
    })

    expect(narrowed.length).toBe(1)
    expect(restored.length).toBe(POOL.length)
  })

  it('4. position filter shows only selected position', () => {
    const out = filterByPosition(POOL, 'RB')
    expect(names(out).sort()).toEqual(['Atlas Runner', 'Echo Guard'].sort())
  })

  it('5. all-position filter restores list', () => {
    const out = filterByPosition(POOL, 'All')
    expect(out).toEqual(POOL)
  })

  it('6. rookie toggle shows rookies only', () => {
    const rows = [
      { name: 'Rookie One', position: 'WR', yearsExp: 0 },
      { name: 'Veteran One', position: 'RB', yearsExp: 7 },
    ]
    const out = applyRookiesOnly(rows, true)
    expect(out.map((r) => r.name)).toEqual(['Rookie One'])
  })

  it('7. rookie toggle off restores rookies into normal pool', () => {
    const rows = [
      { name: 'Rookie One', position: 'WR', yearsExp: 0 },
      { name: 'Veteran One', position: 'RB', yearsExp: 7 },
    ]
    const out = applyRookiesOnly(rows, false)
    expect(out.map((r) => r.name).sort()).toEqual(['Rookie One', 'Veteran One'].sort())
  })

  it('8. drafted players are excluded when drafted filtering is active', () => {
    const out = applyDraftFilters(POOL, {
      searchQuery: '',
      positionFilter: 'All',
      draftedNames: new Set(['Atlas Runner']),
      showDrafted: false,
    })
    expect(names(out)).not.toContain('Atlas Runner')
  })
})

describe('Slice 4 — interaction integrity contracts', () => {
  const playerPanelSrc = read('components/app/draft-room/PlayerPanel.tsx')
  const pageClientSrc = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('9. queue action stays available after filtering (not gated by canDraft)', () => {
    expect(playerPanelSrc).toContain('data-testid={`draft-queue-add-${index}`}')
    expect(playerPanelSrc).toContain('onClick={() => onAddToQueue(p)}')
    expect(playerPanelSrc).toContain('secondaryAction={')
  })

  it('10. draft button disabled state depends on canDraft and drafted status only', () => {
    expect(playerPanelSrc).toContain('disabled={!canDraft || isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds)}')
    expect(playerPanelSrc).toContain('!canDraft')
    expect(playerPanelSrc).toContain("'Not your turn'")
    expect(playerPanelSrc).toContain('isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds)')
    expect(playerPanelSrc).toContain("'Player already drafted'")
  })

  it('11. mobile quick search switches to Players tab and focuses search input', () => {
    expect(pageClientSrc).toContain('const openMobilePlayerSearch = () => {')
    expect(pageClientSrc).toContain("setMobileTab('players')")
    expect(pageClientSrc).toContain("dispatchEvent(new Event('af:draft-player-search-focus'))")
    expect(playerPanelSrc).toContain("addEventListener('af:draft-player-search-focus', onFocusSearch)")
  })

  it('12. filter changes are local UI state and do not mutate draft session state/current pick', () => {
    expect(playerPanelSrc).toContain("const [searchQuery, setSearchQuery] = useState('')")
    expect(playerPanelSrc).toContain("const [positionFilter, setPositionFilter] = useState('All')")
    expect(playerPanelSrc).toContain("const [teamFilter, setTeamFilter] = useState('All')")
    // Off by default; only a dynasty rookie draft opens with it on (`defaultRookiesOnly`).
    expect(playerPanelSrc).toContain('const [rookiesOnly, setRookiesOnly] = useState(defaultRookiesOnly)')
    expect(playerPanelSrc).toContain('defaultRookiesOnly = false,')
    expect(playerPanelSrc).toContain('const [hideDrafted, setHideDrafted] = useState(true)')

    expect(playerPanelSrc.includes('setSession(')).toBe(false)
    expect(playerPanelSrc.includes('setCurrentPick(')).toBe(false)
  })
})
