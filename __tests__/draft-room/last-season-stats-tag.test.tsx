import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerSeasonStats: { findMany } } }))

import { loadStoredDraftSeasonStats } from '@/lib/draft-room/storedDraftSeasonStats'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'
import { SleeperPoolTable } from '@/components/app/draft-room/SleeperPoolTable'
import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'

/**
 * A player with no game this season carries last season's line. Seen on production 2026-11-25:
 * Jimmy Butler's 2025–26 numbers sat in the pool under the same small tag as everyone's 2026–27 ones.
 */
const rates = { pointsPerGame: 19.5, reboundsPerGame: 5.4, minutesPerGame: 31.2 }
const lastSeason = () => normalizeDraftPlayer({ name: 'Hurt Veteran', position: 'SF', team: 'GSW', playerId: '170', nbaDraftStats: rates, statSeason: '2025–26', statSeasonIsPrevious: true }, 'NBA')
const thisSeason = () => normalizeDraftPlayer({ name: 'Healthy Guard', position: 'PG', team: 'BOS', playerId: '171', nbaDraftStats: rates, statSeason: '2026–27', statSeasonIsPrevious: false }, 'NBA')

beforeEach(() => findMany.mockReset())

describe('last season\'s stats are marked as last season\'s', () => {
  it('the loader says when the line it returns is the previous season', async () => {
    findMany.mockResolvedValue([
      { playerId: '170', season: '2025', gamesPlayed: 39, position: 'SF', stats: { games_played: 39, points: 760 } },
      { playerId: '171', season: '2025', gamesPlayed: 70, position: 'PG', stats: { games_played: 70, points: 1400 } },
      { playerId: '171', season: '2026', gamesPlayed: 10, position: 'PG', stats: { games_played: 10, points: 250 } },
    ])
    const stats = await loadStoredDraftSeasonStats('NBA', ['170', '171'], 2026)
    expect(stats.get('170')).toMatchObject({ statSeason: '2025–26', statSeasonIsPrevious: true })
    expect(stats.get('171')).toMatchObject({ statSeason: '2026–27', statSeasonIsPrevious: false })
  })

  it('measures "previous" against the newest season on file, not the calendar year the caller passes', async () => {
    // A mock draft has no league and passes the calendar year. An NBA season is stored under the year
    // it starts in, so from January that year is one more than every row on file. Compared with it,
    // the whole league's current numbers would read as last season's.
    findMany.mockResolvedValue([
      { playerId: '170', season: '2025', gamesPlayed: 39, position: 'SF', stats: { games_played: 39, points: 760 } },
      { playerId: '171', season: '2026', gamesPlayed: 40, position: 'PG', stats: { games_played: 40, points: 900 } },
    ])
    const january = await loadStoredDraftSeasonStats('NBA', ['170', '171'], 2027)
    expect(january.get('171')).toMatchObject({ statSeason: '2026–27', statSeasonIsPrevious: false })
    // Two seasons are read, the one asked for and the one before: a 2025 line is out of reach of 2027.
    expect(january.get('170')).toBeUndefined()
    // Before a new season's first game every line is the same season: nothing to set apart.
    findMany.mockResolvedValue([
      { playerId: '170', season: '2026', gamesPlayed: 60, position: 'SF', stats: { games_played: 60, points: 1200 } },
      { playerId: '171', season: '2026', gamesPlayed: 70, position: 'PG', stats: { games_played: 70, points: 1400 } },
    ])
    const offseason = await loadStoredDraftSeasonStats('NBA', ['170', '171'], 2027)
    expect([...offseason.values()].map((s) => s.statSeasonIsPrevious)).toEqual([false, false])
  })

  it('carries the mark onto the pool entry, and only with a season to mark', () => {
    expect(lastSeason().display.stats.seasonIsPrevious).toBe(true)
    expect(thisSeason().display.stats.seasonIsPrevious).toBeUndefined()
    expect(normalizeDraftPlayer({ name: 'No Stats', position: 'C', team: 'BOS', statSeasonIsPrevious: true }, 'NBA').display.stats.seasonIsPrevious).toBeUndefined()
  })

  it('the player card names the season as last season', () => {
    render(<DraftPlayerCard name="Hurt Veteran" position="SF" team="GSW" draftSport="NBA" variant="card" display={lastSeason().display} />)
    expect(screen.getByText('2025–26 (last season) · PPG 19.5 · RPG 5.4 · MPG 31.2')).toBeInTheDocument()
  })

  it('the pool table gives last season its own tag and leaves this season\'s label alone', () => {
    const entries = [lastSeason(), thisSeason()] as unknown as PlayerEntry[]
    const noop = () => {}
    const { container } = render(
      <SleeperPoolTable
        filtered={entries} draftedNames={new Set()} selectedPlayer={null} isPlayerDrafted={() => false}
        canDraft={false} useAiAdp={false} draftSport="NBA" onDraftRequest={noop} onAddToQueue={noop}
        onPlayerSelect={noop} onCompareTap={noop} scrollRef={React.createRef<HTMLDivElement>()} compareAnchor={null}
        disableVirtualization
      />,
    )
    const tags = container.querySelectorAll('[data-testid$="-last-season-stats"]')
    expect(tags).toHaveLength(1)
    expect(tags[0]?.textContent).toBe('2025–26 · last season')
    expect(tags[0]?.getAttribute('title')).toMatch(/last season's numbers/)
    expect(screen.getByText('2026–27')).toBeInTheDocument()
    expect(screen.queryByText('2025–26')).toBeNull()
  })
})
