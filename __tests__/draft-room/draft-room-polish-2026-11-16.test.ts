import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeStarterNeedsForDisplay } from '@/lib/draft-room/teamNeeds'
import { stickyHeaderOffset } from '@/components/app/draft-room/useStickyBoardHeader'
import { describeCommissionerPickEdit, describeDraftPickTrade } from '@/lib/draft-room/postDraftRoomEventChat'
import { selectNewMirroredPicks } from '@/lib/draft/sleeperSync'
import { buildDraftChatWireMessage } from '@/lib/draft-room/draft-chat-contract'

const read = (p: string) => readFileSync(p, 'utf8')

describe('Starter needs show short slot codes and fill flex from overflow', () => {
  const slots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, DST: 1, K: 1 }

  it('never shows FLEX / SUPERFLEX / DST spelled out', () => {
    const labels = computeStarterNeedsForDisplay({ picks: [], starterSlots: slots }).map((n) => n.position)
    expect(labels).toEqual(['QB', 'RB', 'WR', 'TE', 'FLX', 'SF', 'K', 'DEF'])
  })

  it('a second QB fills SF, a third RB fills FLX', () => {
    const picks = ['QB', 'QB', 'RB', 'RB', 'RB'].map((position) => ({ position }))
    const needs = Object.fromEntries(
      computeStarterNeedsForDisplay({ picks, starterSlots: slots }).map((n) => [n.position, `${n.have}/${n.target}`]),
    )
    expect(needs.QB).toBe('2/1')
    expect(needs.SF).toBe('1/1')
    expect(needs.FLX).toBe('1/1')
    expect(needs.RB).toBe('3/2')
  })

  it('merges two spellings of the same slot', () => {
    const needs = computeStarterNeedsForDisplay({ picks: [], starterSlots: { FLEX: 1, FLX: 1 } })
    expect(needs).toEqual([{ position: 'FLX', have: 0, target: 2, remaining: 2, tone: 'thin' }])
  })

  it('the War Room uses the display helper', () => {
    expect(read('components/app/draft-room/DraftTeamPanel.tsx')).toMatch(
      /^\s*const teamNeeds = computeStarterNeedsForDisplay\(/m,
    )
  })
})

describe('Board header follows the vertical scroll', () => {
  it('stays put until the grid scrolls under the pin line', () => {
    expect(stickyHeaderOffset({ pinLine: 100, gridTop: 140, gridHeight: 800, headerHeight: 48 })).toBe(0)
  })
  it('moves down by exactly the scrolled distance', () => {
    expect(stickyHeaderOffset({ pinLine: 100, gridTop: -150, gridHeight: 800, headerHeight: 48 })).toBe(250)
  })
  it('never leaves the bottom of the grid', () => {
    expect(stickyHeaderOffset({ pinLine: 100, gridTop: -2000, gridHeight: 800, headerHeight: 48 })).toBe(752)
  })
  it('is wired to the team header', () => {
    const board = read('components/app/draft-room/DraftBoard.tsx')
    expect(board).toMatch(/^\s*useStickyBoardHeader\(teamGridRef, teamHeaderRef/m)
    expect(board).toMatch(/^\s*ref=\{teamHeaderRef\}/m)
  })
})

describe('No unexplained minus number', () => {
  it('board tiles say "early" / "late" instead of a bare signed number', () => {
    const cell = read('components/app/draft-room/DraftBoardCell.tsx')
    expect(cell).toMatch(/`\$\{pick\.adpDelta\} late`/)
    expect(cell).toMatch(/`\$\{Math\.abs\(pick\.adpDelta\)\} early`/)
    expect(cell).not.toMatch(/`−\$\{Math\.abs\(pick\.adpDelta\)\}`/)
  })
})

describe('Player card opens from the board and for drafted pool rows', () => {
  it('drafted pool rows are no longer blocked from opening the card', () => {
    const pool = read('components/app/draft-room/SleeperPoolTable.tsx')
    // The row itself opens the card for every player; only the queue button keeps its drafted guard.
    expect(pool).toMatch(/^\s*onClick=\{\(\) => onSelect\(\)\}/m)
    expect(pool).not.toMatch(/^\s*if \(!drafted\) onSelect\(\)/m)
  })
  it('board cells take an open-player handler and the room renders the card', () => {
    expect(read('components/app/draft-room/DraftBoard.tsx')).toMatch(/onOpenPlayer=\{onOpenPlayer \? \(\) => onOpenPlayer\(pick\.overall\) : undefined\}/)
    const room = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(room).toMatch(/^\s*onOpenPlayer=\{setBoardCardOverall\}/m)
    expect(room).toMatch(/^\s*\{boardCardPick \? \(/m)
  })
  it('the card renders into <body> so no panel can trap it', () => {
    expect(read('components/app/draft-room/PlayerDetailModal.tsx')).toMatch(/createPortal\(card, document\.body\)/)
  })
})

describe('No "AI" in draft room copy', () => {
  it('the pick badge says Chimmy pick', () => {
    expect(read('components/app/draft-room/DraftPlayerCard.tsx')).toMatch(/^\s*Chimmy pick\s*$/m)
  })
  it('no draft-room translation value contains the word AI', () => {
    const en = read('lib/i18n/translations-en.ts')
    const bad = en.split('\n').filter((l) => /^\s*"draftRoom\.[^"]+":\s*".*\bAI\b/.test(l))
    expect(bad).toEqual([])
  })
})

describe('Draft chat cards for trades, commissioner changes and mirrored picks', () => {
  it('describes a trade in one sentence', () => {
    expect(describeDraftPickTrade({ proposerName: 'Kings', receiverName: 'Brigade', giveRound: 2, receiveRound: 3 }).detail).toBe(
      'Kings sent their Round 2 pick to Brigade for a Round 3 pick.',
    )
  })

  it('describes each commissioner action', () => {
    const base = { pickLabel: '1.04' }
    expect(describeCommissionerPickEdit({ ...base, action: 'REPLACE_PLAYER_ON_PICK', oldPlayerName: 'A', newPlayerName: 'B' }).detail).toBe(
      'Replaced A with B at pick 1.04.',
    )
    expect(describeCommissionerPickEdit({ ...base, action: 'REMOVE_PLAYER_FROM_PICK', oldPlayerName: 'A' }).detail).toBe('Removed A from pick 1.04.')
    expect(describeCommissionerPickEdit({ ...base, action: 'CHANGE_PICK_OWNER', oldOwnerName: 'X', newOwnerName: 'Y' }).detail).toBe(
      'Moved pick 1.04 from X to Y.',
    )
  })

  it('announces only picks that are new this sync, and stays quiet on a catch-up', () => {
    const before = [1, 2, 3].map((overall) => ({ overall, playerId: `p${overall}` }))
    const rows = [1, 2, 3, 4, 5].map((overall) => ({ overall, playerId: `p${overall}` }))
    expect(selectNewMirroredPicks({ status: 'in_progress', teams: 12, before, rows }).map((r) => r.overall)).toEqual([4, 5])
    // First mirror of a draft already 40 picks in: nothing, rather than 40 cards.
    const deep = Array.from({ length: 40 }, (_, i) => ({ overall: i + 1, playerId: `p${i + 1}` }))
    expect(selectNewMirroredPicks({ status: 'in_progress', teams: 12, before: [], rows: deep })).toEqual([])
    expect(selectNewMirroredPicks({ status: 'pre_draft', teams: 12, before: [], rows: rows.slice(0, 1) })).toEqual([])
    // Same seat, different player (Sleeper commissioner swap) is news.
    expect(
      selectNewMirroredPicks({ status: 'in_progress', teams: 12, before, rows: [{ overall: 2, playerId: 'other' }] }).map((r) => r.overall),
    ).toEqual([2])
  })

  it('a stored draft_event row reaches the room as a card', () => {
    const wire = buildDraftChatWireMessage(
      {
        id: 'm1',
        leagueId: 'L',
        threadId: 'L',
        senderUserId: 'u1',
        senderName: 'Commish',
        body: 'Pick trade: Kings sent...',
        messageType: 'draft_event',
        createdAt: '2026-11-16T20:00:00.000Z',
        metadata: { draftRoomEvent: { kind: 'pick_trade', title: 'Pick trade', detail: 'Kings sent their Round 2 pick to Brigade for a Round 3 pick.' } },
      } as never,
      { syncActive: true, leagueId: 'L', sanitizePlayerContext: () => null, parsePollPayload: () => null, viewerUserId: 'u2' } as never,
    )
    expect(wire.draftRoomEvent?.kind).toBe('pick_trade')
    expect(wire.draftRoomEvent?.detail).toMatch(/Round 2 pick/)
  })

  it('the loader pulls event rows alongside pick rows', () => {
    expect(read('lib/draft-room/draftRoomChatWireLoad.ts')).toMatch(/messageTypeIn: \['draft_pick', 'draft_event'\]/)
  })
})
