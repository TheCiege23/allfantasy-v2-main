// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The shared injury readers behind My Team, the matchup board, Chimmy's lineup checks, the news
 * ticker, the AI injury lists and the draft AI context (2026-10-11).
 *
 * 🛑 Each of these could show a cleared or different player as hurt:
 *  - `readInjuryStatusById` took the most recently FETCHED row, so Rolling Insights re-pulling
 *    Friday's "Questionable" beat ESPN's Sunday "Active", and with no club it took a namesake's row;
 *  - `listInjuryFacts({ statuses })` filtered in SQL before picking each player's newest claim, so a
 *    cleared player's "Active" was gone and his older "Questionable" stood;
 *  - Chimmy's lineup check fell back to a stored "Out" exactly when no live row existed;
 *  - Chimmy's chat context fell back to the newest EXPIRED history row;
 *  - the draft AI context listed every provider's row, "Active" beside "Questionable".
 */

const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  findMany: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsInjury: { findMany: (...a: unknown[]) => db.findMany(...a) },
    sportsNews: { findMany: async () => [] },
  },
}))

import { readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { enrichLineupAvailability } from '@/lib/chimmy/lineupAvailability'
import { buildDraftAiContext } from '@/lib/draft/ai-context'
import { currentInjuryStatusForContext } from '@/lib/agents/anthropic-pipeline'

const HOUR = 3_600_000
const ago = (h: number) => new Date(Date.now() - h * HOUR)
const live = () => new Date(Date.now() + 6 * HOUR)

/** A minimal stand-in for the SQL `where` the readers send: enough to reproduce the old bugs. */
function applyWhere(rows: Array<Record<string, any>>, where: Record<string, any> = {}) {
  return rows.filter((r) => {
    if (where.expiresAt?.gt && !(r.expiresAt > where.expiresAt.gt)) return false
    if (where.status?.in && !where.status.in.includes(r.status)) return false
    if (typeof where.team === 'string' && r.team !== where.team) return false
    return true
  })
}

beforeEach(() => {
  db.rows = []
  db.findMany.mockReset()
  // Fetch-time order, newest pull first: the order the old readers trusted.
  db.findMany.mockImplementation(async (args: any) =>
    applyWhere(db.rows, args?.where).sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime()),
  )
})

const chaseRi = () => ({
  id: 'ri', playerName: "Ja'Marr Chase", team: 'Cincinnati Bengals', position: 'WR', status: 'Questionable',
  source: 'rolling_insights', type: null, description: null, week: null,
  date: ago(48), fetchedAt: ago(0.02), expiresAt: live(),
})
const chaseEspn = () => ({
  id: 'espn', playerName: "Ja'Marr Chase", team: 'CIN', position: 'WR', status: 'Active',
  source: 'espn', type: null, description: null, week: null,
  date: ago(3), fetchedAt: ago(0.4), expiresAt: live(),
})

describe('readInjuryStatusById — My Team, the matchup board, Chimmy lineups', () => {
  it("🛑 the newest REPORT wins: Rolling Insights re-pulling Friday's Questionable does not beat ESPN's Active", async () => {
    db.rows = [chaseRi(), chaseEspn()]
    const out = await readInjuryStatusById('NFL', new Map([['1', ["Ja'Marr Chase"]]]), new Map([['1', 'CIN']]))
    expect(out.get('1')).toBe('Active')
  })

  it("🛑 position tells namesakes apart when no club is given — the LB's Out is not the WR's", async () => {
    db.rows = [
      { playerName: 'Justin Jefferson', team: 'Cleveland Browns', position: 'LB', status: 'Out', date: ago(2), fetchedAt: ago(0.1), expiresAt: live() },
      { playerName: 'Justin Jefferson', team: 'Minnesota Vikings', position: 'WR', status: 'Active', date: ago(2), fetchedAt: ago(0.5), expiresAt: live() },
    ]
    const out = await readInjuryStatusById('NFL', new Map([['18', ['Justin Jefferson']]]), undefined, new Map([['18', 'WR']]))
    expect(out.get('18')).toBe('Active')
  })

  it('refuses a name two athletes share when nothing tells them apart', async () => {
    db.rows = [
      { playerName: 'Justin Jefferson', team: 'Cleveland Browns', position: 'LB', status: 'Out', date: ago(2), fetchedAt: ago(0.1), expiresAt: live() },
      { playerName: 'Justin Jefferson', team: 'Minnesota Vikings', position: 'WR', status: 'Active', date: ago(2), fetchedAt: ago(0.5), expiresAt: live() },
    ]
    const out = await readInjuryStatusById('NFL', new Map([['18', ['Justin Jefferson']]]))
    expect(out.has('18')).toBe(false)
  })
})

describe('enrichLineupAvailability — no live report', () => {
  it('🛑 a stored "Out" is not revived for a player no feed carries any more', async () => {
    const out = await enrichLineupAvailability('NFL', new Map([
      ['healed', { name: 'Healed Player', position: 'RB', team: 'ATL', injury: 'Out' }],
    ]))
    expect(out.get('healed')?.injury ?? null).toBeNull()
  })

  it('a roster designation the feeds do not carry still holds', async () => {
    const out = await enrichLineupAvailability('NFL', new Map([
      ['ir', { name: 'Long Term', position: 'WR', team: 'NYJ', injury: 'Injured Reserve' }],
    ]))
    expect(out.get('ir')?.injury).toBe('IR')
  })
})

describe('listInjuryFacts — filters apply to each player’s CURRENT claim', () => {
  it("🛑 a status filter does not resurrect a cleared player's older Questionable", async () => {
    db.rows = [chaseRi(), chaseEspn()]
    const list = await listInjuryFacts({ sport: 'NFL', statuses: ['Out', 'Doubtful', 'Questionable', 'IR'] })
    expect(list.facts.map((f) => f.playerName)).not.toContain("Ja'Marr Chase")
  })

  it('designationsOnly drops players whose current claim is Active, keeps the hurt ones', async () => {
    db.rows = [
      chaseRi(),
      chaseEspn(),
      { id: 'x', playerName: 'Puka Nacua', team: 'LAR', position: 'WR', status: 'Out', source: 'espn', type: null, description: null, week: null, date: ago(5), fetchedAt: ago(0.3), expiresAt: live() },
    ]
    const list = await listInjuryFacts({ sport: 'NFL', designationsOnly: true })
    expect(list.facts.map((f) => f.playerName)).toEqual(['Puka Nacua'])
  })

  it('a team filter of "MIN" finds the rows a feed spelled "Minnesota Vikings"', async () => {
    db.rows = [
      { id: 'j', playerName: 'Justin Jefferson', team: 'Minnesota Vikings', position: 'WR', status: 'Questionable', source: 'rolling_insights', type: null, description: null, week: null, date: ago(5), fetchedAt: ago(0.3), expiresAt: live() },
    ]
    const list = await listInjuryFacts({ sport: 'NFL', team: 'MIN' })
    expect(list.facts.map((f) => f.playerName)).toEqual(['Justin Jefferson'])
  })
})

describe('Chimmy chat context — current status', () => {
  it('🛑 an expired history row is not stated as current', () => {
    const history = [
      { status: 'Out', expiresAt: ago(30) },
      { status: 'Questionable', expiresAt: ago(60) },
    ]
    expect(currentInjuryStatusForContext(null, history)).toBe('unknown')
  })

  it('the newest LIVE row is used when the primary source is silent', () => {
    const history = [
      { status: 'Out', expiresAt: ago(30) },
      { status: 'Doubtful', expiresAt: live() },
    ]
    expect(currentInjuryStatusForContext(null, history)).toBe('Doubtful')
    expect(currentInjuryStatusForContext('Questionable', history)).toBe('Questionable')
  })
})

describe('draft AI context — injuries', () => {
  it('🛑 one current claim per player, and a cleared player is not listed', async () => {
    db.rows = [
      chaseRi(),
      chaseEspn(),
      { playerName: 'Puka Nacua', team: 'LAR', status: 'Out', type: 'Knee', date: ago(5), fetchedAt: ago(0.3), expiresAt: live() },
      { playerName: 'Puka Nacua', team: 'LAR', status: 'Out', type: 'Knee', date: ago(5), fetchedAt: ago(0.1), expiresAt: live() },
    ]
    const ctx = await buildDraftAiContext({ sport: 'NFL' })
    expect(ctx.injuries.map((i) => `${i.player}:${i.status}`)).toEqual(['Puka Nacua:Out'])
  })
})
