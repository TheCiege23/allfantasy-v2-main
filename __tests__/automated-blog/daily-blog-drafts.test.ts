/**
 * Daily blog drafts — the guarantees that make an unattended writer safe to run:
 * only games whose box score adds up to the final are used, a draft naming a number or player
 * outside the facts is thrown away, at most two drafts a day, one per sport per date, never published.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: vi.fn(),
  parseJsonContentFromChatCompletion: (data: any) => {
    const c = data?.choices?.[0]?.message?.content
    try {
      return typeof c === 'string' ? JSON.parse(c) : null
    } catch {
      return null
    }
  },
}))

import {
  baseGameId,
  easternDate,
  formatDateLabel,
  rankPerformers,
  verifyGames,
  type GameNightFacts,
  type RawGame,
  type RawLine,
} from '@/lib/automated-blog/daily/gameNightFacts'
import { checkDraftAgainstFacts, numberTokens } from '@/lib/automated-blog/daily/factCheck'
import { dailyDraftSlug, serializeFacts, writeGameNightDraft, type ChatJson } from '@/lib/automated-blog/daily/gameNightDraft'
import { runDailyBlogDrafts, type DailyDraftDeps } from '@/lib/automated-blog/daily/runDailyBlogDrafts'

afterEach(() => vi.unstubAllEnvs())

const nba = (gameId: string, team: string, opponent: string, player: string, stats: Record<string, number>): RawLine => ({
  gameId,
  team,
  opponent,
  playerName: player,
  position: null,
  group: 'all',
  stats,
})

const GAME: RawGame = { externalId: 'g1', homeTeam: 'HOU', awayTeam: 'UTA', homeScore: 50, awayScore: 30, status: 'completed' }
const LINES: RawLine[] = [
  nba('g1', 'HOU', 'UTA', 'Alperen Sengun', { points: 43, total_rebounds: 12, assists: 5, field_goals_made: 17, field_goals_attempted: 24 }),
  nba('g1', 'HOU', 'UTA', 'Bench Guy', { points: 7 }),
  nba('g1', 'UTA', 'HOU', 'Lauri Markkanen', { points: 30, total_rebounds: 8 }),
]

describe('verifyGames — a game is used only when its box score adds up to the final', () => {
  it('keeps a completed game whose lines sum to both teams’ scores', () => {
    const r = verifyGames('NBA', [GAME], LINES)
    expect(r.verified).toEqual([{ gameId: 'g1', home: 'HOU', away: 'UTA', homeScore: 50, awayScore: 30 }])
    expect(r.dropped).toBe(0)
  })

  it('drops a game whose lines are one basket short (a feed that stopped polling)', () => {
    const r = verifyGames('NBA', [{ ...GAME, homeScore: 52 }], LINES)
    expect(r.verified).toEqual([])
    expect(r.dropped).toBe(1)
  })

  it('drops a game that is not completed, even when the numbers agree', () => {
    expect(verifyGames('NBA', [{ ...GAME, status: 'in progress' }], LINES).verified).toEqual([])
  })

  it('NHL: strips the :skaters / :goalies suffix and counts goalie goals', () => {
    const lines: RawLine[] = [
      { gameId: 'h1:skaters', team: 'CAR', opponent: 'SEA', playerName: 'A', position: 'C', group: 'skaters', stats: { goals: 2 } },
      { gameId: 'h1:goalies', team: 'CAR', opponent: 'SEA', playerName: 'G', position: 'G', group: 'goalies', stats: { goalie_goals: 1, goals: 99 } },
      { gameId: 'h1:skaters', team: 'SEA', opponent: 'CAR', playerName: 'B', position: 'D', group: 'skaters', stats: { goals: 1 } },
    ]
    const game: RawGame = { externalId: 'h1', homeTeam: 'CAR', awayTeam: 'SEA', homeScore: 3, awayScore: 1, status: 'completed' }
    expect(baseGameId('h1:goalies')).toBe('h1')
    expect(verifyGames('NHL', [game], lines).verified).toHaveLength(1)
    // A shootout winner's extra goal is credited to no skater, so the game drops rather than lies.
    expect(verifyGames('NHL', [{ ...game, homeScore: 4 }], lines).verified).toHaveLength(0)
  })
})

describe('rankPerformers', () => {
  it('orders by fantasy night and only uses verified games', () => {
    const other = nba('g2', 'BOS', 'NYK', 'Unverified Star', { points: 60 })
    const { performers } = rankPerformers('NBA', [...LINES, other], [
      { gameId: 'g1', home: 'HOU', away: 'UTA', homeScore: 50, awayScore: 30 },
    ])
    expect(performers.map((p) => p.name)).toEqual(['Alperen Sengun', 'Lauri Markkanen', 'Bench Guy'])
    expect(performers[0].line).toBe('43 PTS, 12 REB, 5 AST, 17-of-24 FG')
  })

  it('NHL goalies are listed separately with saves on shots', () => {
    const lines: RawLine[] = [
      { gameId: 'h1:goalies', team: 'SEA', opponent: 'CAR', playerName: 'Philipp Grubauer', position: 'G', group: 'goalies', stats: { win: 1, saves: 22, shots_against: 23, goals_allowed: 1 } },
    ]
    const { goalies } = rankPerformers('NHL', lines, [{ gameId: 'h1', home: 'CAR', away: 'SEA', homeScore: 1, awayScore: 2 }])
    expect(goalies[0].line).toBe('W, 22 saves on 23 shots, 1 GA')
  })
})

describe('dates', () => {
  it('uses the US Eastern date, so a 12:00 UTC fire writes about the previous ET night', () => {
    expect(easternDate(new Date('2026-11-15T12:00:00Z'), 1)).toBe('2026-11-14')
    // 03:00 UTC is still the previous evening in New York.
    expect(easternDate(new Date('2026-11-15T03:00:00Z'), 0)).toBe('2026-11-14')
    expect(formatDateLabel('2026-11-14')).toBe('November 14, 2026')
  })
})

describe('numberTokens', () => {
  it('ignores list markers and link targets, normalises commas, reads spelled-out stat counts', () => {
    expect(numberTokens('1. He had 43 points\n2. Then 1,204 yards')).toEqual(['43', '1204'])
    expect(numberTokens('[Waiver Advisor](/waiver-ai?week=12)')).toEqual([])
    expect(numberTokens('three assists and a +2')).toEqual(['2', '3'])
  })
})

const FACTS_TEXT = 'Alperen Sengun (HOU vs UTA): 43 PTS, 12 REB, 5 AST, 17-of-24 FG\nGames: 9'
const UNIVERSE = ['Alperen Sengun', 'LeBron James', 'Lauri Markkanen']

describe('checkDraftAgainstFacts', () => {
  const check = (text: string, allowed = ['Alperen Sengun']) =>
    checkDraftAgainstFacts({ draftTexts: [text], factsText: FACTS_TEXT, allowedNames: allowed, nameUniverse: UNIVERSE })

  it('passes a draft that only restates the facts', () => {
    expect(check("Alperen Sengun's 43 points and 12 rebounds led a 9-game night.").ok).toBe(true)
  })

  it('rejects an invented number', () => {
    expect(check('Alperen Sengun scored 45 points.')).toMatchObject({ ok: false, unknownNumbers: ['45'] })
  })

  it('rejects a percentage the model computed itself, even a correct one', () => {
    // 17/24 = 70.8% — true, but not in the facts, so not checkable, so not allowed.
    expect(check('He shot 70.8% from the field.')).toMatchObject({ ok: false, unknownNumbers: ['70.8'] })
  })

  it('rejects a spelled-out count that is not in the facts', () => {
    expect(check('He added seven assists.')).toMatchObject({ ok: false, unknownNumbers: ['7'] })
  })

  it('rejects a real player who is not in the day’s facts', () => {
    expect(check('Not since LeBron James has anyone done that.')).toMatchObject({ ok: false, unknownNames: ['LeBron James'] })
  })

  it('does not match a name inside a longer word', () => {
    const r = checkDraftAgainstFacts({ draftTexts: ['Alperen Senguns fans'], factsText: FACTS_TEXT, allowedNames: [], nameUniverse: ['Alperen Sengun'] })
    expect(r.unknownNames).toEqual([])
  })
})

const FACTS: GameNightFacts = {
  sport: 'NBA',
  date: '2026-11-14',
  dateLabel: 'November 14, 2026',
  games: [{ gameId: 'g1', home: 'HOU', away: 'UTA', homeScore: 125, awayScore: 118 }],
  droppedGames: 0,
  performers: [{ name: 'Alperen Sengun', team: 'HOU', opponent: 'UTA', line: '43 PTS, 12 REB, 5 AST', rank: 70, kind: 'player' }],
  goalies: [],
}

const BODY_OK =
  'Alperen Sengun owned the night with 43 points, 12 rebounds and 5 assists against UTA. ' +
  'That is the kind of line that swings a points matchup on its own, and it helps in points, rebounds and assists in a categories week. ' +
  'HOU won 125 to 118.'

function chatReturning(body: string, excerpt = 'Sengun’s 43 led the night.'): ChatJson {
  return vi.fn(async () => ({
    ok: true as const,
    json: { choices: [{ message: { content: JSON.stringify({ body, excerpt, seoDescription: 'Who helped fantasy teams.' }) } }] },
  }))
}

describe('writeGameNightDraft', () => {
  it('sends the serialized facts and sets title, slug and footer in code', async () => {
    const chat = chatReturning(BODY_OK)
    const r = await writeGameNightDraft({ facts: FACTS, nameUniverse: UNIVERSE, chat })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.draft.title).toBe('Fantasy Basketball Standouts: November 14, 2026')
    expect(r.draft.slug).toBe('nba-fantasy-standouts-2026-11-14')
    expect(r.draft.body).toContain('[Start a free fantasy basketball league](/sports/fantasy-basketball)')
    const sent = (chat as any).mock.calls[0][0]
    expect(sent.messages[1].content).toBe(serializeFacts(FACTS))
    expect(sent.skipCache).toBe(true)
  })

  it('throws away a draft with an invented stat', async () => {
    const r = await writeGameNightDraft({ facts: FACTS, nameUniverse: UNIVERSE, chat: chatReturning(BODY_OK + ' He is averaging 28.4 this season.') })
    expect(r).toMatchObject({ ok: false, reason: 'fact_check_failed' })
  })

  it('a model failure or an empty answer produces no draft — no fallback text', async () => {
    const failing: ChatJson = vi.fn(async () => ({ ok: false as const, status: 500 }))
    expect(await writeGameNightDraft({ facts: FACTS, nameUniverse: UNIVERSE, chat: failing })).toMatchObject({ ok: false, reason: 'generation_failed' })
    expect(await writeGameNightDraft({ facts: FACTS, nameUniverse: UNIVERSE, chat: chatReturning('too short') })).toMatchObject({ ok: false, reason: 'bad_output' })
  })
})

function deps(over: Partial<DailyDraftDeps> = {}): DailyDraftDeps & { saved: string[] } {
  const saved: string[] = []
  const facts = (sport: 'NBA' | 'NHL', games: number): GameNightFacts => ({
    ...FACTS,
    sport,
    games: Array.from({ length: games }, (_, i) => ({ gameId: `g${i}`, home: 'A', away: 'B', homeScore: 1, awayScore: 0 })),
    performers: Array.from({ length: 6 }, (_, i) => ({ ...FACTS.performers[0], name: `P${i}` })),
  })
  return {
    saved,
    loadFacts: vi.fn(async (sport) => facts(sport, sport === 'NBA' ? 9 : 7)),
    loadNames: vi.fn(async () => []),
    write: vi.fn(async (f) => ({ ok: true as const, check: { ok: true, unknownNumbers: [], unknownNames: [] }, draft: { title: 't', slug: dailyDraftSlug(f.sport, f.date), excerpt: 'e', body: 'b', seoTitle: 's', seoDescription: 'd', tags: [] } })),
    saveDraft: vi.fn(async (_sport, d) => {
      saved.push(d.slug)
      return { articleId: `id-${d.slug}`, slug: d.slug }
    }),
    slugExists: vi.fn(async () => false),
    countRecent: vi.fn(async () => 0),
    ...over,
  }
}

const NOW = new Date('2026-11-15T12:00:00Z')

describe('runDailyBlogDrafts', () => {
  it('writes one draft per sport for last night, biggest slate first', async () => {
    const d = deps()
    const r = await runDailyBlogDrafts({ now: NOW, deps: d })
    expect(r.date).toBe('2026-11-14')
    expect(d.saved).toEqual(['nba-fantasy-standouts-2026-11-14', 'nhl-fantasy-standouts-2026-11-14'])
  })

  it('🛑 the daily cap counts what is already in the database, so a second fire adds nothing', async () => {
    const one = deps({ countRecent: vi.fn(async () => 1) })
    await runDailyBlogDrafts({ now: NOW, deps: one })
    expect(one.saved).toEqual(['nba-fantasy-standouts-2026-11-14'])

    const full = deps({ countRecent: vi.fn(async () => 2) })
    const r = await runDailyBlogDrafts({ now: NOW, deps: full })
    expect(full.saved).toEqual([])
    expect(r.skipped.map((s) => s.reason)).toEqual(['cap', 'cap'])
  })

  it('🛑 is idempotent: an existing slug for that sport and date is skipped, never suffixed', async () => {
    const d = deps({ slugExists: vi.fn(async (slug: string) => slug.startsWith('nba')) })
    const r = await runDailyBlogDrafts({ now: NOW, deps: d })
    expect(d.saved).toEqual(['nhl-fantasy-standouts-2026-11-14'])
    expect(r.skipped).toContainEqual({ sport: 'NBA', reason: 'exists' })
  })

  it('skips a thin night and reports a discarded draft without saving it', async () => {
    const d = deps({
      loadFacts: vi.fn(async (sport) => ({ ...FACTS, sport, games: sport === 'NHL' ? [] : [FACTS.games[0], FACTS.games[0], FACTS.games[0]], droppedGames: 2, performers: Array(6).fill(FACTS.performers[0]) })),
      write: vi.fn(async () => ({ ok: false as const, reason: 'fact_check_failed' as const, check: { ok: false, unknownNumbers: ['45'], unknownNames: [] } })),
    })
    const r = await runDailyBlogDrafts({ now: NOW, deps: d })
    expect(d.saved).toEqual([])
    expect(r.skipped).toContainEqual({ sport: 'NHL', reason: 'thin', detail: '0 verified game(s), 2 dropped' })
    expect(r.skipped).toContainEqual({ sport: 'NBA', reason: 'fact_check_failed', detail: 'numbers: 45' })
  })

  it('a dry run calls no model and writes nothing', async () => {
    const d = deps()
    const r = await runDailyBlogDrafts({ now: NOW, mode: 'dry', deps: d })
    expect(d.write).not.toHaveBeenCalled()
    expect(d.saveDraft).not.toHaveBeenCalled()
    expect(r.wouldCreate.map((w) => w.slug)).toEqual(['nba-fantasy-standouts-2026-11-14', 'nhl-fantasy-standouts-2026-11-14'])
  })

  it('BLOG_DAILY_DRAFTS=off stops it before it reads anything', async () => {
    vi.stubEnv('BLOG_DAILY_DRAFTS', 'off')
    const d = deps()
    expect(await runDailyBlogDrafts({ now: NOW, deps: d })).toMatchObject({ ran: false, reason: 'disabled' })
    expect(d.loadFacts).not.toHaveBeenCalled()
  })
})
