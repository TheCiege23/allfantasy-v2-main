import { describe, expect, it, vi } from 'vitest'

import {
  NO_SLEEPER_ID_REASON,
  loadSnapShare,
  loadSnapShares,
} from '@/lib/core-app/snapShare'

/**
 * Snap share shipped for months as a hardcoded "not ingested by any current provider" while the
 * columns sat on disk. These pin the computation now that two surfaces read it — the player page
 * for one player, the defence hub for a roster — so the pair cannot drift apart.
 */

type Log = { playerId: string; normalizedStatMap: Record<string, unknown> }

const fakePrisma = (logs: Log[]) =>
  ({
    playerGameStat: { findMany: vi.fn(async () => logs) },
  }) as never

const game = (playerId: string, m: Record<string, number>): Log => ({
  playerId,
  normalizedStatMap: m,
})

describe('loadSnapShares — the arithmetic', () => {
  it('sums the totals and divides once, instead of averaging per-game shares', async () => {
    /*
     * THE RULE. One sixty-snap start at 100% and one two-snap cameo at 4% is 62 of 110 snaps —
     * 56%. A mean of the two shares says 52%, which reads as a part-time role for a player who
     * started. The error grows with every cameo.
     */
    const prisma = fakePrisma([
      game('1', { off_snp: 60, tm_off_snp: 60 }),
      game('1', { off_snp: 2, tm_off_snp: 50 }),
    ])

    const res = await loadSnapShares({
      prisma,
      players: [{ sleeperId: '1', position: 'WR' }],
    })

    const out = res.get('1')
    expect(out?.available).toBe(true)
    if (!out?.available) return
    expect(out.data.snaps).toBe(62)
    expect(out.data.teamSnaps).toBe(110)
    expect(out.data.share).toBeCloseTo(0.564, 3)
    expect(out.data.games).toBe(2)
  })

  it('reads each side of the ball off its own columns', async () => {
    const prisma = fakePrisma([
      game('lb', { def_snp: 50, tm_def_snp: 60, off_snp: 4, tm_off_snp: 65 }),
      game('wr', { off_snp: 55, tm_off_snp: 65, def_snp: 1, tm_def_snp: 60 }),
    ])

    const res = await loadSnapShares({
      prisma,
      players: [
        { sleeperId: 'lb', position: 'LB' },
        { sleeperId: 'wr', position: 'WR' },
      ],
    })

    const lb = res.get('lb')
    const wr = res.get('wr')
    // A linebacker's four offensive snaps are special teams, not a role.
    expect(lb?.available && lb.data.basis).toBe('defense')
    expect(lb?.available && lb.data.snaps).toBe(50)
    expect(wr?.available && wr.data.basis).toBe('offense')
    expect(wr?.available && wr.data.snaps).toBe(55)
  })

  it('skips a game missing either column rather than counting it as zero snaps', async () => {
    const prisma = fakePrisma([
      game('1', { off_snp: 40, tm_off_snp: 60 }),
      game('1', { off_snp: 30 }), // no team total — the share is unknowable, not zero
      game('1', { off_snp: 20, tm_off_snp: 0 }), // a game the team did not play
    ])

    const res = await loadSnapShares({ prisma, players: [{ sleeperId: '1', position: 'RB' }] })
    const out = res.get('1')
    expect(out?.available && out.data.games).toBe(1)
    expect(out?.available && out.data.snaps).toBe(40)
  })
})

describe('loadSnapShares — what it refuses', () => {
  it('says so when no game carries both columns, naming them', async () => {
    const prisma = fakePrisma([game('1', { rec: 5 })])
    const res = await loadSnapShares({ prisma, players: [{ sleeperId: '1', position: 'WR' }] })
    const out = res.get('1')
    expect(out?.available).toBe(false)
    expect(out?.available === false && out.reason).toContain('off_snp')
    expect(out?.available === false && out.reason).toContain('tm_off_snp')
  })

  it('names the DEFENSIVE columns when refusing for a defender', async () => {
    // Otherwise the reason misdescribes what we looked for, which sends the next reader hunting
    // for a column that was never relevant.
    const prisma = fakePrisma([])
    const out = await loadSnapShare(fakePrisma([]), { sleeperId: '1', position: 'LB' })
    expect(out.available).toBe(false)
    expect(out.available === false && out.reason).toContain('def_snp')
    void prisma
  })

  it('refuses without querying at all when no player carries a Sleeper id', async () => {
    const prisma = fakePrisma([])
    const res = await loadSnapShares({ prisma, players: [{ sleeperId: null, position: 'WR' }] })
    expect(res.size).toBe(0)

    const single = await loadSnapShare(prisma, { sleeperId: '  ', position: 'WR' })
    expect(single.available).toBe(false)
    expect(single.available === false && single.reason).toBe(NO_SLEEPER_ID_REASON)
  })
})

describe('loadSnapShares — the many-player traps', () => {
  it('slices the game cap PER PLAYER, not across the whole result', async () => {
    /*
     * THE TRAP THIS FUNCTION EXISTS TO AVOID. Generalising the single-player query by keeping
     * `take: 40 * ids.length` truncates by the GLOBAL ordering — so a player whose games are all
     * older than everyone else's falls off the end and reads as having no snap data at all,
     * which is indistinguishable from a player nobody tracks.
     */
    const busy = Array.from({ length: 45 }, () => game('busy', { off_snp: 50, tm_off_snp: 60 }))
    const quiet = [game('quiet', { off_snp: 30, tm_off_snp: 60 })]
    const prisma = fakePrisma([...busy, ...quiet])

    const res = await loadSnapShares({
      prisma,
      players: [
        { sleeperId: 'busy', position: 'WR' },
        { sleeperId: 'quiet', position: 'WR' },
      ],
    })

    const q = res.get('quiet')
    expect(q?.available).toBe(true)
    expect(q?.available && q.data.games).toBe(1)

    // And the busy player is still capped at the 40 most recent, not all 45.
    const b = res.get('busy')
    expect(b?.available && b.data.games).toBe(40)
  })

  it('does not double-count a player who appears twice in the input', async () => {
    // `SportsPlayer` carries duplicate rows per Sleeper id — 571 rostered ids resolved to 1,329
    // rows when measured. A roster assembled from it will hand the same player over twice.
    const prisma = fakePrisma([game('1', { off_snp: 40, tm_off_snp: 60 })])
    const res = await loadSnapShares({
      prisma,
      players: [
        { sleeperId: '1', position: 'RB' },
        { sleeperId: '1', position: 'RB' },
      ],
    })

    expect(res.size).toBe(1)
    const out = res.get('1')
    expect(out?.available && out.data.snaps).toBe(40)
  })

  it('answers for every player asked about, including the ones with nothing on file', async () => {
    const prisma = fakePrisma([game('has', { off_snp: 40, tm_off_snp: 60 })])
    const res = await loadSnapShares({
      prisma,
      players: [
        { sleeperId: 'has', position: 'RB' },
        { sleeperId: 'none', position: 'RB' },
      ],
    })

    // A missing key would make the caller guess; an explicit refusal tells it what happened.
    expect(res.size).toBe(2)
    expect(res.get('none')?.available).toBe(false)
  })
})
