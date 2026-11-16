/**
 * Room v2 league signatures (2026-11), on top of the league-type accents: which concept the room
 * is, Survivor tribe colours on the board, and one per-type chip on drafted tiles (age, or a
 * college pick's class year).
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DraftBoard } from '@/components/app/draft-room/DraftBoard'
import { draftRoomLeagueConceptRaw, normalizeLeagueConcept } from '@/lib/draft-room/leagueAccent'
import { tileSignatureChip, tileSignatureChipsByOverall } from '@/lib/draft-room/leagueSignature'

afterEach(cleanup)

const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('which concept the room is', () => {
  const concept = (league: Parameters<typeof draftRoomLeagueConceptRaw>[0]) =>
    normalizeLeagueConcept(draftRoomLeagueConceptRaw(league))

  it('a specialty stored as its base still reads as itself', () => {
    // leagueTypeConfirmation writes pirate → its base, efl → dynasty, survivor_guillotine → guillotine.
    expect(concept({ leagueType: 'dynasty', leagueVariant: 'pirate' })).toBe('pirate')
    expect(concept({ leagueType: 'redraft', leagueVariant: 'pirate' })).toBe('pirate')
    expect(concept({ leagueType: 'guillotine', leagueVariant: 'survivor_guillotine' })).toBe('survivor_guillotine')
    expect(concept({ leagueType: 'dynasty', settings: { leagueTypeConfirmation: { type: 'efl' } } })).toBe('efl')
  })

  it('a confirmed concept wins over the column and the variant', () => {
    expect(concept({ leagueType: 'redraft', leagueVariant: 'pirate', settings: { leagueTypeConfirmation: { type: 'keeper' } } })).toBe('keeper')
  })

  it('any other variant does not override the column', () => {
    // A redraft league with a guillotine modifier is not a Guillotine league.
    expect(concept({ leagueType: 'redraft', leagueVariant: 'guillotine' })).toBe('redraft')
    expect(concept({ leagueType: 'dynasty', leagueVariant: 'devy_dynasty' })).toBe('dynasty')
    expect(draftRoomLeagueConceptRaw({ leagueType: null, leagueVariant: null })).toBeNull()
  })

  it('the live and auction routes both carry it to the room', () => {
    const ctx = src('lib/draft/resolve-draft-context.ts')
    expect(ctx).toContain('leagueType: draftRoomLeagueConceptRaw(resolvedLeague)')
    expect(ctx.match(/leagueVariant: true,\s*settings: true/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(ctx).toContain('leagueType: true, leagueVariant: true, settings: true }')
    expect(src('app/draft/[draftId]/auction/page.tsx')).toContain('leagueType={context.leagueType}')
  })
})

describe('the tile signature chip', () => {
  it('dynasty-family leagues show age', () => {
    for (const c of ['dynasty', 'keeper', 'devy', 'c2c', 'efl'] as const) {
      expect(tileSignatureChip(c, { age: 24 })).toEqual({ kind: 'age', text: '24y', title: 'Age 24' })
    }
    expect(tileSignatureChip('dynasty', { age: '27' })?.text).toBe('27y')
    expect(tileSignatureChip('dynasty', { display: { metadata: { age: 31 } } })?.text).toBe('31y')
  })

  it('a college pick in devy or c2c shows its class year instead', () => {
    expect(tileSignatureChip('devy', { isDevy: true, age: 20, classYearLabel: 'JR' })).toEqual({ kind: 'class', text: 'JR', title: 'Junior' })
    expect(tileSignatureChip('c2c', { poolType: 'college', classYearLabel: 'so' })?.title).toBe('Sophomore')
    expect(tileSignatureChip('c2c', { poolType: 'pro', age: 25, classYearLabel: 'SR' })?.kind).toBe('age')
    // A label too long for the tile's line is not printed.
    expect(tileSignatureChip('devy', { isDevy: true, classYearLabel: 'Redshirt Junior' })).toBeNull()
  })

  it('every other concept, and bad data, draws nothing', () => {
    for (const c of ['redraft', 'best_ball', 'guillotine', 'survivor', 'tournament', 'salary_cap', 'big_brother', 'zombie', 'pirate'] as const) {
      expect(tileSignatureChip(c, { age: 24, classYearLabel: 'JR', isDevy: true })).toBeNull()
    }
    expect(tileSignatureChip('dynasty', { age: 4 })).toBeNull()
    expect(tileSignatureChip('dynasty', { age: 'n/a' })).toBeNull()
    expect(tileSignatureChip('dynasty', {})).toBeNull()
  })

  it('finds each pick its pool player by id, then by name + position + team', () => {
    const picks = [
      { overall: 1, playerId: 'a1', playerName: 'Atlas Runner', position: 'RB', team: 'NYJ' },
      { overall: 2, playerId: 'other-id', playerName: 'Bo Hands', position: 'WR', team: 'GB' },
      { overall: 3, playerId: 'zz', playerName: 'Nobody Known', position: 'TE', team: 'KC' },
      { overall: 4, playerId: null, playerName: '', position: '', team: '' },
    ]
    const pool = [
      { playerId: 'a1', name: 'Atlas Runner', position: 'RB', team: 'NYJ', age: 23 },
      { playerId: 'b1', name: 'Bo Hands', position: 'WR', team: 'GB', age: 29 },
    ]
    expect(tileSignatureChipsByOverall('dynasty', picks, pool)).toEqual({
      1: { kind: 'age', text: '23y', title: 'Age 23' },
      2: { kind: 'age', text: '29y', title: 'Age 29' },
    })
    expect(tileSignatureChipsByOverall('redraft', picks, pool)).toEqual({})
  })

  it('the room passes the chips to the board', () => {
    const room = src('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(room).toContain('tileSignatureChipsByOverall(\n        leagueAccent.concept,')
    expect(room).toContain('signatureByOverall={boardSignatureByOverall}')
  })
})

const tribes = {
  red: { id: 't-red', name: 'Ember', colorHex: '#e11d48', markUrl: null, crestUrl: null },
  blue: { id: 't-blue', name: 'Tide', colorHex: '#2563eb', markUrl: null, crestUrl: null },
}

const drafted = {
  id: 'p1', overall: 1, round: 1, slot: 1, rosterId: 'r1', displayName: 'Team 1', playerName: 'Atlas Runner',
  position: 'RB', team: 'NYJ', byeWeek: 9, playerId: 'a1', tradedPickMeta: null, pickLabel: '1.01', createdAt: '',
} as unknown as Parameters<typeof DraftBoard>[0]['picks'][number]

function renderBoard(props: Partial<Parameters<typeof DraftBoard>[0]> = {}) {
  return render(
    <DraftBoard
      picks={[drafted]}
      slotOrder={[1, 2, 3].map((slot) => ({ slot, rosterId: `r${slot}`, displayName: `Team ${slot}` }))}
      teamCount={3}
      rounds={2}
      draftType="snake"
      thirdRoundReversal={false}
      {...props}
    />,
  )
}

describe('Survivor tribes on the board', () => {
  const slotOrder = [
    { slot: 1, rosterId: 'r1', displayName: 'Team 1', tribe: tribes.red },
    { slot: 2, rosterId: 'r2', displayName: 'Team 2', tribe: tribes.blue },
    { slot: 3, rosterId: 'r3', displayName: 'Team 3', tribe: tribes.red },
  ]

  it('each column header carries its tribe colour, and every tile in it an edge', () => {
    renderBoard({ slotOrder })
    expect(screen.getByTestId('draft-board-team-header-tribe-bar-1').style.backgroundColor).toBe('rgb(225, 29, 72)')
    expect(screen.getByTestId('draft-board-team-header-tribe-bar-2').style.backgroundColor).toBe('rgb(37, 99, 235)')
    // Round 1 slot 1 is the made pick; round 2 slot 1 (snake: overall 6) is empty. Both get the edge.
    expect(screen.getByTestId('draft-board-cell-tribe-edge-1').style.backgroundColor).toBe('rgb(225, 29, 72)')
    expect(screen.getByTestId('draft-board-cell-tribe-edge-6').style.backgroundColor).toBe('rgb(225, 29, 72)')
    expect(screen.getByTestId('draft-board-cell-tribe-edge-2').style.backgroundColor).toBe('rgb(37, 99, 235)')
  })

  it('the legend names each tribe once, in its colour', () => {
    renderBoard({ slotOrder })
    expect(screen.getByTestId('draft-board-legend-tribe-t-red').textContent).toBe('Ember')
    expect(screen.getByTestId('draft-board-legend-tribe-t-blue').textContent).toBe('Tide')
    expect(screen.getAllByTestId(/^draft-board-legend-tribe-/)).toHaveLength(2)
  })

  it('no locked tribes, no colour: the board is unchanged', () => {
    renderBoard()
    expect(screen.queryAllByTestId(/tribe-(bar|edge)-/)).toHaveLength(0)
    expect(screen.queryAllByTestId(/^draft-board-legend-tribe-/)).toHaveLength(0)
    // A tribe with no valid colour draws no edge either.
    cleanup()
    renderBoard({ slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'Team 1', tribe: { ...tribes.red, colorHex: null } }] })
    expect(screen.queryAllByTestId(/tribe-(bar|edge)-/)).toHaveLength(0)
  })
})

describe('the chip on a drafted tile', () => {
  it('prints the chip with its spelled-out title', () => {
    renderBoard({ signatureByOverall: { 1: { kind: 'age', text: '23y', title: 'Age 23' } } })
    const chip = screen.getByTestId('draft-board-cell-signature-1')
    expect(chip.textContent).toBe('23y')
    expect(chip.getAttribute('title')).toBe('Age 23')
    expect(chip.getAttribute('data-kind')).toBe('age')
  })

  it('keeps the info line on one row so the name is never pushed off a narrow tile', () => {
    // Measured: on an 84px tile "WR · DAL 26y" wrapped and the player's name left the tile.
    renderBoard({
      picks: [{ ...drafted, adpDelta: 3 } as typeof drafted],
      signatureByOverall: { 1: { kind: 'age', text: '23y', title: 'Age 23' } },
      adpDeltaByOverall: { 1: -6 },
    })
    const info = screen.getByTestId('draft-board-cell-info-1')
    expect(info.className).toContain('flex-nowrap')
    expect(info.className).not.toContain('flex-wrap')
    // The ADP gap gives way first on a narrow tile.
    expect(screen.getByTestId('draft-board-cell-adp-delta').className).toContain('af-tile-squeezable')
    expect(screen.getByTestId('draft-board-cell-1').className).toContain('[container-type:inline-size]')
    const css = src('app/globals.css')
    const at = css.indexOf('@container (max-width: 119px)')
    expect(at).toBeGreaterThan(-1)
    const before = css.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, '')
    // A top-level rule, never nested inside a @media block (the af-matchup.css trap).
    expect(before.split('{').length - before.split('}').length).toBe(0)
  })

  it('a tile without a chip wraps as before', () => {
    renderBoard({ adpDeltaByOverall: { 1: -6 } })
    expect(screen.getByTestId('draft-board-cell-info-1').className).toContain('flex-wrap')
    expect(screen.getByTestId('draft-board-cell-adp-delta').className).not.toContain('af-tile-squeezable')
  })

  it('an empty tile never shows one', () => {
    renderBoard({ signatureByOverall: { 2: { kind: 'age', text: '30y', title: 'Age 30' } } })
    expect(screen.queryByTestId('draft-board-cell-signature-2')).toBeNull()
  })
})
