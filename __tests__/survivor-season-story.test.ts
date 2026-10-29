/**
 * survivor-core §3 SeasonTimeline: only revealed/public facts reach the season story. Never a
 * voter, never an idol holder who did not share it, never a sealed swap or a non-final moment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLeagueRecords, buildSeasonTimeline, buildTrophyCase, type SeasonStoryInput, type SeasonStoryMoment } from '@/lib/survivor/seasonStory'

const m = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorShareMoment: { findMany: vi.fn() },
    leagueChampionship: { findMany: vi.fn() },
    survivorTribeSwap: { findMany: vi.fn() },
    survivorJuryMember: { findMany: vi.fn() },
    survivorTribe: { findFirst: vi.fn() },
    draftSession: { findFirst: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    survivorVote: { findMany: vi.fn() },
    survivorIdol: { findMany: vi.fn() },
    survivorAuditEntry: { findMany: vi.fn() },
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))

import { loadSeasonStory } from '@/lib/survivor/seasonStoryServer'

function moment(over: Partial<SeasonStoryMoment>): SeasonStoryMoment {
  return { id: 'm', type: 'out', week: 1, final: true, published: false, displayName: 'Open Team 3', season: 2026, tribeName: 'Vela', ...over }
}

function input(over: Partial<SeasonStoryInput> = {}): SeasonStoryInput {
  return { season: 2026, currentSeason: 2026, firstWeek: 1, lastWeek: 13, draftComplete: true, moments: [], swaps: [], jurors: [], mergeWeek: null, mergedTribeName: null, mergedCount: null, now: new Date('2026-10-18T12:00:00Z'), ...over }
}

describe('buildSeasonTimeline', () => {
  it('has a draft node plus one node per week', () => {
    const nodes = buildSeasonTimeline(input())
    expect(nodes).toHaveLength(14)
    expect(nodes[0]).toMatchObject({ key: 'draft', label: 'Idols hidden' })
    expect(nodes[13]).toMatchObject({ week: 13, kind: 'upcoming', card: null })
  })

  it('drops moments that are not final', () => {
    const nodes = buildSeasonTimeline(input({ moments: [moment({ week: 2, final: false })] }))
    expect(nodes.find(n => n.week === 2)?.kind).toBe('upcoming')
  })

  it('names the voted-out manager with display names and the public tally only', () => {
    const node = buildSeasonTimeline(input({ moments: [moment({ week: 3, displayName: 'Open Team 12', tally: '3–2' })] })).find(n => n.week === 3)!
    expect(node).toMatchObject({ kind: 'voted_out', label: 'O12 out' })
    expect(node.card?.headline).toBe('Open Team 12’s torch is out')
    expect(JSON.stringify(node)).not.toMatch(/voter|ballot/i)
  })

  it('does not name an idol holder who never shared the card', () => {
    const node = buildSeasonTimeline(input({ moments: [moment({ type: 'idol', week: 4, displayName: 'Secret Holder', idolName: 'Vote Steal' })] })).find(n => n.week === 4)!
    expect(node.kind).toBe('idol')
    expect(JSON.stringify(node)).not.toContain('Secret Holder')
    expect(JSON.stringify(node)).not.toContain('Vote Steal')
  })

  it('names the idol holder once they published the card themselves', () => {
    const node = buildSeasonTimeline(input({ moments: [moment({ type: 'idol', week: 4, displayName: 'Open Team 4', published: true, idolName: 'Immunity idol' })] })).find(n => n.week === 4)!
    expect(node.card?.headline).toBe('Open Team 4 played an idol')
  })

  it('leaves a sealed or future swap off the timeline', () => {
    const nodes = buildSeasonTimeline(input({ swaps: [{ week: 5, revealedAt: null }, { week: 6, revealedAt: '2026-10-25T00:00:00Z' }, { week: 7, revealedAt: '2026-10-01T00:00:00Z' }] }))
    expect(nodes.find(n => n.week === 5)?.kind).not.toBe('swap')
    expect(nodes.find(n => n.week === 6)?.kind).not.toBe('swap')
    expect(nodes.find(n => n.week === 7)?.kind).toBe('swap')
  })

  it('shows the biggest event of a week and numbers jurors in order', () => {
    const nodes = buildSeasonTimeline(input({
      mergeWeek: 8, mergedTribeName: 'Mahina', mergedCount: 7,
      moments: [moment({ week: 8, displayName: 'Open Team 9' }), moment({ type: 'champ', week: 13, displayName: 'TheCiege26', tally: '3–1–1' })],
      jurors: [{ votedOutWeek: 10, displayName: 'B' }, { votedOutWeek: 9, displayName: 'A' }],
    }))
    expect(nodes.find(n => n.week === 8)).toMatchObject({ kind: 'merge', label: 'Merge' })
    expect(nodes.find(n => n.week === 8)?.card?.headline).toBe('Welcome to Mahina')
    expect(nodes.find(n => n.week === 9)?.label).toBe('Juror 1')
    expect(nodes.find(n => n.week === 10)?.label).toBe('Juror 2')
    expect(nodes.find(n => n.week === 13)).toMatchObject({ kind: 'champion', label: 'Champion' })
  })

  it('keeps another season’s moments, swaps and jurors out of this season', () => {
    const nodes = buildSeasonTimeline(input({ season: 2025, moments: [moment({ week: 2, season: 2026 }), moment({ week: 3, season: 2025 })], swaps: [{ week: 4, revealedAt: '2026-01-01T00:00:00Z' }], jurors: [{ votedOutWeek: 5, displayName: 'J' }] }))
    expect(nodes.find(n => n.week === 2)?.kind).not.toBe('voted_out')
    expect(nodes.find(n => n.week === 3)?.kind).toBe('voted_out')
    expect(nodes.find(n => n.week === 4)?.kind).not.toBe('swap')
    expect(nodes.find(n => n.week === 5)?.kind).not.toBe('juror')
  })
})

describe('trophy case and records', () => {
  it('builds one shelf per season, newest first, with the jury tally', () => {
    const trophies = buildTrophyCase([{ season: 2024, teamName: 'Sunday Scaries', playoffRecord: 'Jury vote' }, { season: 2025, teamName: 'Open Team 5', playoffRecord: 'Jury vote' }], [moment({ type: 'champ', season: 2025, tally: '4–1', immunityWins: 5 })], 'NFL')
    expect(trophies.map(t => t.season)).toEqual([2025, 2024])
    expect(trophies[0].line).toBe('Jury 4–1 · 5 immunity wins')
  })

  it('counts idol records from published cards only', () => {
    const records = buildLeagueRecords([moment({ type: 'idol', displayName: 'Hidden', published: false }), moment({ type: 'idol', displayName: 'Hidden', published: false })], [])
    expect(records.find(r => r.key === 'idols')).toBeUndefined()
    const shared = buildLeagueRecords([moment({ type: 'idol', displayName: 'Shown', published: true })], [])
    expect(shared.find(r => r.key === 'idols')).toMatchObject({ holder: 'Shown', value: '1' })
  })

  it('computes immunity, titles and jury records across seasons', () => {
    const records = buildLeagueRecords([
      moment({ type: 'immunity', displayName: 'Open Team 5', season: 2025 }), moment({ type: 'immunity', displayName: 'Open Team 5', season: 2025 }),
      moment({ type: 'immunity', displayName: 'Open Team 5', season: 2026 }),
      moment({ type: 'champ', displayName: 'Open Team 5', season: 2025, tally: '4–1' }), moment({ type: 'champ', displayName: 'X', season: 2026, tally: '3–2' }),
    ], [{ season: 2025, teamName: 'Open Team 5', playoffRecord: null }, { season: 2026, teamName: 'X', playoffRecord: null }])
    expect(records.find(r => r.key === 'immunity')).toMatchObject({ holder: 'Open Team 5 · 2025', value: '2' })
    expect(records.find(r => r.key === 'titles')).toMatchObject({ holder: 'One each · 2 champions', value: '1' })
    expect(records.find(r => r.key === 'jury')).toMatchObject({ value: '4–1' })
  })
})

describe('loadSeasonStory (server)', () => {
  beforeEach(() => {
    for (const model of Object.values(m.db)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset()
    m.db.league.findUnique.mockResolvedValue({ name: 'Blah Survivor', sport: 'NFL', season: 2026, settings: {}, survivorMergeWeek: 8 })
    m.db.survivorShareMoment.findMany.mockResolvedValue([])
    m.db.leagueChampionship.findMany.mockResolvedValue([])
    m.db.survivorTribeSwap.findMany.mockResolvedValue([])
    m.db.survivorJuryMember.findMany.mockResolvedValue([])
    m.db.survivorTribe.findFirst.mockResolvedValue(null)
    m.db.draftSession.findFirst.mockResolvedValue({ id: 'd' })
    m.db.survivorPlayer.findMany.mockResolvedValue([])
  })

  it('reads final moments and revealed swaps only, and never votes, idols or the audit log', async () => {
    const now = new Date('2026-10-18T12:00:00Z')
    await loadSeasonStory('L1', null, now)
    expect(m.db.survivorShareMoment.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'L1', final: true })
    expect(m.db.survivorTribeSwap.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'L1', revealedAt: { not: null, lte: now } })
    expect(m.db.survivorVote.findMany).not.toHaveBeenCalled()
    expect(m.db.survivorIdol.findMany).not.toHaveBeenCalled()
    expect(m.db.survivorAuditEntry.findMany).not.toHaveBeenCalled()
  })

  it('does not carry the merge before a merged tribe exists', async () => {
    const view = await loadSeasonStory('L1', null)
    expect(view?.nodes.some(n => n.kind === 'merge')).toBe(false)
  })

  it('turns stored moments into nodes and keeps the subject user id out of the payload', async () => {
    m.db.survivorShareMoment.findMany.mockResolvedValue([{ id: 'a', leagueId: 'L1', type: 'out', week: 2, subjectUserId: 'user-secret-id', subjectRosterId: 'roster-secret', payload: { v: 1, displayName: 'Open Team 3', leagueName: 'Blah', sport: 'NFL', season: 2026, tribeName: 'Vela', crestPath: null, tally: '2–1' }, final: true, publishedAt: null, createdAt: new Date() }])
    const view = await loadSeasonStory('L1', null)
    expect(view?.nodes.find(n => n.week === 2)?.label).toBe('O3 out')
    expect(JSON.stringify(view)).not.toContain('user-secret-id')
    expect(JSON.stringify(view)).not.toContain('roster-secret')
  })
})
