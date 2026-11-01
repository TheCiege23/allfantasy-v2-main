/**
 * Draft room correctness pass: traded-pick provenance on MADE picks, the dynasty-only Rookie chip in
 * the pool table, and the board / trade-history copy going through t() in EN + ES.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DraftBoardCell, type DraftBoardCellPick } from '@/components/app/draft-room/DraftBoardCell'
import { describeBoardMode } from '@/components/app/draft-room/DraftBoard'
import { PickTradeHistoryModal } from '@/components/app/draft-room/PickTradeHistoryModal'
import { SleeperPoolTable } from '@/components/app/draft-room/SleeperPoolTable'
import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'
import { positionTintHex } from '@/lib/draft-room/positionTint'
import { translations } from '@/lib/i18n/translations'

vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({
  LazyDraftImage: () => null,
}))

const en = (key: string) => translations.en[key] ?? key

function makePick(overrides: Partial<DraftBoardCellPick> = {}): DraftBoardCellPick {
  return {
    overall: 7,
    round: 1,
    slot: 7,
    pickLabel: '1.07',
    playerName: 'Atlas Runner',
    position: 'RB',
    team: 'DET',
    playerId: 'pid-ar',
    playerImageUrl: null,
    sport: 'NFL',
    injuryStatus: null,
    byeWeek: null,
    displayName: 'Beta',
    ...overrides,
  }
}

const TRADED = { originalRosterId: 'r-alpha', previousOwnerName: 'Alpha', newOwnerName: 'Beta', tintColor: '#ff00aa' }

/** jsdom normalises `#rrggbb` to `rgb(r, g, b)`. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('traded-pick provenance survives the pick', () => {
  it('a made pick on a traded slot keeps a "via <original owner>" marker', () => {
    render(<DraftBoardCell pick={makePick({ tradedPickMeta: TRADED })} isEmpty={false} />)
    const via = screen.getByTestId('draft-board-cell-via-7')
    expect(via.textContent).toBe('via Alpha')
    expect(via.getAttribute('title')).toBe('Originally Alpha')
    // The first name still renders beside it, so the tile keeps its three lines.
    expect(screen.getByTestId('draft-board-cell-7').textContent).toContain('Atlas')
  })

  it('keeps the POSITION tint on a made traded pick, even with trade colouring on', () => {
    render(
      <DraftBoardCell pick={makePick({ tradedPickMeta: TRADED })} isEmpty={false} tradedPickColorMode />,
    )
    const tile = screen.getByTestId('draft-board-cell-7') as HTMLElement
    expect(tile.style.backgroundColor).toBe(hexToRgb(positionTintHex('RB')!))
  })

  it('an untraded made pick has no marker', () => {
    render(<DraftBoardCell pick={makePick()} isEmpty={false} />)
    expect(screen.queryByTestId('draft-board-cell-via-7')).toBeNull()
  })

  it('an EMPTY traded slot still says "from <original owner>" and gets no via marker', () => {
    render(
      <DraftBoardCell
        pick={makePick({ playerName: null, position: null, team: null, tradedPickMeta: TRADED })}
        isEmpty
      />,
    )
    expect(screen.queryByTestId('draft-board-cell-via-7')).toBeNull()
    expect(screen.getByText('from Alpha')).toBeTruthy()
    expect(screen.getByText('from Alpha').getAttribute('title')).toBe('Originally Alpha')
  })

  it('the trade affordance reads its label from the dictionary', () => {
    render(<DraftBoardCell pick={makePick()} isEmpty onTradeFromCell={() => {}} />)
    const btn = screen.getByTestId('draft-board-cell-trade-7')
    expect(btn.getAttribute('title')).toBe('Offer pick trade')
    expect(btn.getAttribute('aria-label')).toBe('Offer pick trade for this slot')
  })
})

describe('describeBoardMode', () => {
  it('produces the same English labels as before', () => {
    expect(describeBoardMode('auction', false, 'Lottery', en)).toBe('Auction purchase board')
    expect(describeBoardMode('snake', true, null, en)).toBe('3RR snake')
    expect(describeBoardMode('snake', true, 'Lottery', en)).toBe('3RR snake | Lottery')
    expect(describeBoardMode('linear', false, null, en)).toBe('Linear')
    expect(describeBoardMode('linear', false, 'Custom', en)).toBe('Linear | Custom')
    expect(describeBoardMode('snake', false, null, en)).toBe('Snake')
    expect(describeBoardMode('snake', false, 'Random', en)).toBe('Snake | Random')
  })

  it('translates to Spanish through the passed t()', () => {
    const es = (key: string) => translations.es[key] ?? key
    expect(describeBoardMode('snake', false, null, es)).toBe('Serpiente')
    expect(describeBoardMode('linear', false, null, es)).toBe('Lineal')
  })
})

describe('PickTradeHistoryModal copy', () => {
  it('counts singular and plural from the dictionary', () => {
    const one = [{ round: 2, originalRosterId: 'a', previousOwnerName: 'Alpha', newRosterId: 'b', newOwnerName: 'Beta' }]
    const { rerender } = render(<PickTradeHistoryModal open onClose={() => {}} tradedPicks={one} />)
    expect(screen.getByText('1 traded pick')).toBeTruthy()
    expect(screen.getByText('Round 2')).toBeTruthy()
    rerender(<PickTradeHistoryModal open onClose={() => {}} tradedPicks={[...one, { ...one[0]!, round: 3 }]} />)
    expect(screen.getByText('2 traded picks')).toBeTruthy()
  })

  it('shows the empty state', () => {
    render(<PickTradeHistoryModal open onClose={() => {}} tradedPicks={[]} />)
    expect(screen.getByText('No picks have been traded yet.')).toBeTruthy()
  })
})

function poolPlayer(overrides: Partial<PlayerEntry>): PlayerEntry {
  return { name: 'Rookie Guy', position: 'WR', team: 'KC', adp: 40, byeWeek: 10, ...overrides } as PlayerEntry
}

function renderPool(filtered: PlayerEntry[], showExperienceLabel?: boolean) {
  const scrollRef = React.createRef<HTMLDivElement>()
  return render(
    <div ref={scrollRef}>
      <SleeperPoolTable
        filtered={filtered}
        draftedNames={new Set()}
        selectedPlayer={null}
        isPlayerDrafted={() => false}
        canDraft={false}
        useAiAdp={false}
        draftSport="NFL"
        onDraftRequest={() => {}}
        onAddToQueue={() => {}}
        onPlayerSelect={() => {}}
        onCompareTap={() => {}}
        scrollRef={scrollRef}
        compareAnchor={null}
        disableVirtualization
        showExperienceLabel={showExperienceLabel}
      />
    </div>,
  )
}

describe('pool table Rookie chip (dynasty only)', () => {
  const rookie = poolPlayer({ isRookie: true, yearsExp: 0 })
  const vet = poolPlayer({ name: 'Vet Guy', isRookie: false, yearsExp: 6 })
  const unknown = poolPlayer({ name: 'Mystery Guy' })

  it('shows Rookie only on the rookie row when enabled', () => {
    renderPool([rookie, vet, unknown], true)
    const badges = screen.getAllByTestId('draft-player-label-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.getAttribute('data-label')).toBe('rookie')
  })

  it('renders no chip at all when the league is not dynasty', () => {
    renderPool([rookie, vet], false)
    expect(screen.queryAllByTestId('draft-player-label-badge')).toHaveLength(0)
  })

  it('never stacks a second label on a Fantrax prospect', () => {
    renderPool([poolPlayer({ name: 'Prospect Kid', isRookie: true, prospectSource: 'fantrax' })], true)
    expect(screen.queryAllByTestId('draft-player-label-badge')).toHaveLength(0)
  })

  it('PlayerPanel turns the chip on from isDynasty, and the page passes isDynasty', () => {
    const panel = readFileSync(resolve(process.cwd(), 'components/app/draft-room/PlayerPanel.tsx'), 'utf8')
    expect(panel).toMatch(/<SleeperPoolTable[\s\S]*?showExperienceLabel=\{isDynasty\}/)
    const page = readFileSync(resolve(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')
    expect(page).toMatch(/<SportAwareDraftRoom[\s\S]*?isDynasty=\{isDynasty\}/)
  })
})

describe('new draft-room strings exist in EN and ES', () => {
  const keys = [
    'draftRoom.board.offerPickTrade',
    'draftRoom.board.offerPickTradeAria',
    'draftRoom.board.fromOwner',
    'draftRoom.board.originally',
    'draftRoom.board.viaOwner',
    'draftRoom.board.mode.auction',
    'draftRoom.board.mode.thirdRoundReversal',
    'draftRoom.board.mode.linear',
    'draftRoom.board.mode.snake',
    'draftRoom.tradeHistory.title',
    'draftRoom.tradeHistory.countOne',
    'draftRoom.tradeHistory.countOther',
    'draftRoom.tradeHistory.close',
    'draftRoom.tradeHistory.empty',
    'draftRoom.tradeHistory.round',
    'draftRoom.tradeHistory.unknownOwner',
    'draftRoom.tradeHistory.footer',
  ]
  it.each(keys)('%s', (key) => {
    expect(translations.en[key], `en ${key}`).toBeTruthy()
    expect(translations.es[key], `es ${key}`).toBeTruthy()
    expect(translations.es[key]).not.toBe(translations.en[key])
    expect(translations.es[key]!.toLowerCase()).not.toContain('waiver')
  })
})
