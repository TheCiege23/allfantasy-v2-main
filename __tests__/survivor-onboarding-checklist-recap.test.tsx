// @vitest-environment jsdom
/**
 * Three Survivor additions, 2026-10-31:
 *  - a "how Survivor works" guide on the league home through the first week, from this league's rules;
 *  - a commissioner checklist on the league home (before the draft) and this week's to-do (in season);
 *  - a week recap share card any member may share. Since 2026-10-31 it names the manager voted out
 *    and rides the Torch Ceremony post in league chat as its picture — one message for the league.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  council: null as Record<string, unknown> | null,
  created: [] as Array<Record<string, unknown>>,
  players: [] as Array<{ userId: string; playerState: string }>,
  posted: [] as Array<Record<string, unknown>>,
}))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({
  createSurvivorChatMessage: vi.fn(async (_db: unknown, args: { data: Record<string, unknown> }) => { h.posted.push(args.data); return { id: 'msg-1' } }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ name: 'Blah Survivor', sport: 'NFL', season: 2026, settings: { survivorFoundationSettings: { eliminationOutcome: 'exile_island' } }, survivorPhase: 'pre_merge' })) },
    survivorLeagueConfig: { findUnique: vi.fn(async () => null) },
    survivorTribalCouncil: { findFirst: vi.fn(async () => h.council) },
    survivorPlayer: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { userId: string } } }) => ({ userId: where.leagueId_userId.userId, displayName: 'Out Team', tribeId: 'tribe-1', redraftRosterId: 'r-out', exileWeeksServed: 0 })),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => h.players),
    },
    survivorTribe: { findUnique: vi.fn(async () => ({ name: 'Vela', logoUrl: null, isMerged: false })) },
    survivorWeeklyScore: { findMany: vi.fn(async () => [{ finalScore: 50 }]), count: vi.fn(async () => 3) },
    survivorIdol: { findUnique: vi.fn(async () => null) },
    survivorChatChannel: { findFirst: vi.fn(async () => ({ id: 'league-chat' })) },
    survivorShareMoment: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => {
        if (!where.id) return null
        const row = h.created.find((_, i) => `id-${i + 1}` === where.id)
        return row ? { id: where.id, final: true, publishedAt: null, createdAt: new Date(), subjectRosterId: null, ...row } : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { h.created.push(data); return { id: `id-${h.created.length}` } }),
      count: vi.fn(async () => 0),
    },
  },
}))

import { buildShareCardContent, shareSheetHeading } from '@/lib/survivor/shareCards/cardContent'
import { isMomentOfferedTo, canPublishMoment } from '@/lib/survivor/shareCards/momentAccess'
import { captureCouncilShareMoments, RECAP_SUBJECT, weekRecapCounts } from '@/lib/survivor/shareCards/momentCapture'
import { momentRowToStory } from '@/lib/survivor/seasonStoryServer'
import { firstWeekGuideSteps, showFirstWeekGuide, type FirstWeekGuideRules } from '@/lib/survivor/survivorFirstWeekGuide'
import { survivorCommissionerChecklist, withoutSeatIssues, type SurvivorChecklistFacts } from '@/lib/survivor/survivorCommissionerChecklist'
import { SurvivorFirstWeekGuide } from '@/components/survivor/SurvivorFirstWeekGuide'
import { SurvivorCommissionerChecklist } from '@/components/survivor/SurvivorCommissionerChecklist'

const payload = { v: 1 as const, displayName: 'Blah Survivor', leagueName: 'Blah Survivor', sport: 'NFL', season: 2026, tribeName: 'Vela', crestPath: null }

describe('week recap share card', () => {
  it('names who was voted out, the public tally, where they go next and who is left', () => {
    const card = buildShareCardContent('recap', 7, { ...payload, displayName: 'Maya', tally: '2–1', next: 'exile', remaining: 11, onExile: 4, merged: false })
    expect(card.kicker).toBe('Week 7 · Tribal Council')
    expect(card.headline).toBe('Maya is voted out')
    expect(card.sub).toBe('Voted out 2–1 from Tribe Vela. Heading to Exile Island. 11 castaways remain.')
    expect(card.stats).toEqual([{ value: '2–1', label: 'Vote' }, { value: '11', label: 'Remaining' }, { value: '4', label: 'On Exile' }])
    expect(shareSheetHeading('recap', false)).toBe('Share this week’s recap')
  })

  it('after the merge it names no tribe, and a league without Exile shows the week instead', () => {
    const card = buildShareCardContent('recap', 12, { ...payload, displayName: 'Jo', tribeName: null, tally: '3–1', next: 'jury', remaining: 1, onExile: null, merged: true })
    expect(card.sub).toBe('Voted out 3–1. Takes a seat on the jury. 1 castaway remains.')
    expect(card.stats.map(stat => stat.label)).toEqual(['Vote', 'Remaining', 'Week'])
  })

  it('is offered to every league member, and to nobody outside the league', () => {
    const recap = { type: 'recap' as const, subjectUserId: RECAP_SUBJECT, final: true, publishedAt: null }
    expect(isMomentOfferedTo(recap, { userId: 'anyone', isLeagueMember: true })).toBe(true)
    expect(canPublishMoment(recap, { userId: 'anyone', isLeagueMember: true })).toBe(true)
    expect(isMomentOfferedTo(recap, { userId: 'stranger', isLeagueMember: false })).toBe(false)
    // CONTROL: the out card is still the voted-out manager's alone.
    const out = { type: 'out' as const, subjectUserId: 'out-user', final: true, publishedAt: null }
    expect(isMomentOfferedTo(out, { userId: 'anyone', isLeagueMember: true })).toBe(false)
  })

  it('counts the voted-out manager as gone even before their state flips', () => {
    const players = [
      { userId: 'a', playerState: 'active' }, { userId: 'b', playerState: 'active' }, { userId: 'out', playerState: 'active' },
      { userId: 'x', playerState: 'exile' }, { userId: 'j', playerState: 'jury' },
    ]
    expect(weekRecapCounts(players, 'out', true)).toEqual({ remaining: 2, onExile: 2 })
    expect(weekRecapCounts(players, 'out', false)).toEqual({ remaining: 2, onExile: 1 })
  })

  it('is captured once per council read under its council-fixed id, names the manager, and posts nothing itself', async () => {
    h.created = []
    h.posted = []
    h.players = [{ userId: 'a', playerState: 'active' }, { userId: 'b', playerState: 'active' }, { userId: 'out-user', playerState: 'active' }]
    h.council = {
      id: 'c-9', leagueId: 'league-1', week: 5, phase: 'pre_merge', attendingTribeId: 'tribe-1', isRevealed: true, isTie: false,
      eliminatedUserId: 'out-user', eliminatedRosterId: 'r-out', eliminatedName: 'Out Team', revealSequence: [], idolsPlayed: [],
    }
    await captureCouncilShareMoments('league-1', 'c-9')
    const recap = h.created.find(row => row.type === 'recap')!
    expect(recap.dedupeKey).toBe('recap:c-9')
    expect(recap.id).toBe('recap-c-9')
    expect(recap.subjectUserId).toBe(RECAP_SUBJECT)
    const body = recap.payload as Record<string, unknown>
    expect(body).toMatchObject({ remaining: 2, onExile: 1, merged: false, tribeName: 'Vela', displayName: 'Out Team', next: 'exile' })
    // The public tally only: no voter, no ballot.
    expect(JSON.stringify(body)).not.toMatch(/voter|ballot|targetUserId/i)
    // The Torch Ceremony post carries this card (survivorVoteTallyService); the recap posts nothing.
    expect(h.posted).toHaveLength(0)
    const card = buildShareCardContent('recap', 5, body as never)
    expect(`${card.headline}. ${card.sub}`).toBe('Out Team is voted out. Voted out from Tribe Vela at Tribal Council. Heading to Exile Island. 2 castaways remain.')
  })

  it('is not captured for a tie', async () => {
    h.created = []
    h.council = { ...h.council!, id: 'c-tie', isTie: true }
    await captureCouncilShareMoments('league-1', 'c-tie')
    expect(h.created.find(row => row.type === 'recap')).toBeUndefined()
  })

  it('stays out of the season story timeline', () => {
    const row = { id: 'm', leagueId: 'l', type: 'recap', week: 3, subjectUserId: RECAP_SUBJECT, subjectRosterId: null, payload: { ...payload, remaining: 9 }, final: true, publishedAt: null, createdAt: new Date() }
    expect(momentRowToStory(row as never)).toBeNull()
    expect(momentRowToStory({ ...row, type: 'out' } as never)?.type).toBe('out')
  })
})

const rules: FirstWeekGuideRules = {
  tribeName: 'Vela', idolCount: 6, mergeTrigger: 'week', mergeWeek: 9, mergePlayerCount: null,
  exileReturnEnabled: true, exileReturnTokens: 4, exileReturnWeek: 10, finalistCount: 3, finaleWeek: 18,
}

describe('first-week guide', () => {
  it('explains the week from this league\'s own rules', () => {
    const steps = firstWeekGuideSteps(rules)
    expect(steps.map(step => step.id)).toEqual(['tribe', 'council', 'vote', 'idols', 'exile', 'merge'])
    const text = (id: string) => steps.find(step => step.id === id)!.body
    expect(text('tribe')).toContain('You are on Tribe Vela.')
    expect(text('idols')).toContain('6 idols are hidden')
    expect(text('exile')).toContain('After week 10, the exile with the most tokens returns to the game, as long as they have at least 4.')
    expect(text('merge')).toContain('The tribes merge in week 9.')
    expect(text('merge')).toContain('final 3 in week 18')
  })

  it('a league without Exile or idols, merging on a count, says so', () => {
    const steps = firstWeekGuideSteps({ ...rules, idolCount: 0, exileReturnEnabled: false, mergeTrigger: 'player_count', mergePlayerCount: 10 })
    expect(steps.some(step => step.id === 'idols')).toBe(false)
    expect(steps.find(step => step.id === 'exile')!.title).toBe('Voted out is final')
    expect(steps.find(step => step.id === 'merge')!.body).toContain('when 10 castaways remain')
  })

  it('shows to players through week 1 only', () => {
    expect(showFirstWeekGuide(0, true)).toBe(true)
    expect(showFirstWeekGuide(1, true)).toBe(true)
    expect(showFirstWeekGuide(2, true)).toBe(false)
    expect(showFirstWeekGuide(1, false)).toBe(false)
  })
})

describe('commissioner checklist', () => {
  const ready: SurvivorChecklistFacts = {
    leagueSize: 16, claimedManagers: 16, draftScheduled: true, draftStatus: 'scheduled', tribesDrawn: 0,
    exileEnabled: true, exileLinked: true, idolCount: 6, setupIssues: [],
  }

  it('reads as ready when everything is set (tribes wait for the draft)', () => {
    const items = survivorCommissionerChecklist(ready)
    expect(items.filter(item => item.state === 'todo')).toEqual([])
    expect(items.find(item => item.id === 'tribes')!.state).toBe('waiting')
  })

  it('names open seats, a missing draft time and setup problems', () => {
    const items = survivorCommissionerChecklist({ ...ready, claimedManagers: 12, draftScheduled: false, draftStatus: 'pre_draft', setupIssues: ['Idol inventory disagrees between league settings and the Survivor engine.'] })
    const state = Object.fromEntries(items.map(item => [item.id, item.state]))
    expect(state).toMatchObject({ seats: 'todo', draft: 'todo', settings: 'todo' })
    expect(items.find(item => item.id === 'seats')!.detail).toBe('4 of 16 seats are still open. Share the invite link.')
  })

  it('an unlinked Exile league waits before the draft and needs attention after it', () => {
    expect(survivorCommissionerChecklist({ ...ready, exileLinked: false }).find(item => item.id === 'exile')!.state).toBe('waiting')
    expect(survivorCommissionerChecklist({ ...ready, exileLinked: false, tribesDrawn: 4 }).find(item => item.id === 'exile')!.state).toBe('todo')
    expect(survivorCommissionerChecklist({ ...ready, exileEnabled: false, exileLinked: false }).find(item => item.id === 'exile')!.state).toBe('done')
  })

  it('leaves seat lines to the seat row', () => {
    expect(withoutSeatIssues(['3 manager seats still need to be claimed.', 'Exile is enabled but its side league is not linked.'])).toEqual(['Exile is enabled but its side league is not linked.'])
  })
})

describe('home cards', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('the guide closes and stays closed for this league', async () => {
    const { unmount } = render(<SurvivorFirstWeekGuide leagueId="L1" rules={rules} />)
    await waitFor(() => expect(screen.getByTestId('survivor-first-week-guide')).toBeTruthy())
    fireEvent.click(screen.getByTestId('survivor-first-week-guide-close'))
    expect(screen.queryByTestId('survivor-first-week-guide')).toBeNull()
    unmount()
    render(<SurvivorFirstWeekGuide leagueId="L1" rules={rules} />)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByTestId('survivor-first-week-guide')).toBeNull()
    cleanup()
    render(<SurvivorFirstWeekGuide leagueId="L2" rules={rules} />)
    await waitFor(() => expect(screen.getByTestId('survivor-first-week-guide')).toBeTruthy())
  })

  const dashboard = {
    ok: true, league: { id: 'L1', name: 'L', sport: 'NBA', leagueSize: 16 }, shell: { draftSessionExists: true, survivorChatChannels: 2, exileLeagueLinked: true },
    operations: { claimedManagers: 14, draft: { status: 'scheduled', picksMade: 0, totalPicks: 192, timerSeconds: 60 }, readinessIssues: ['2 manager seats still need to be claimed.'] },
    config: { exileReturnEnabled: true, idolCount: 6 }, tribes: [],
    todo: { week: 3, headline: 'One thing needs you', items: [], actionCount: 1 },
  }

  it('before the draft the checklist reads the commissioner dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(dashboard), { status: 200 })))
    render(<SurvivorCommissionerChecklist leagueId="L1" draftScheduled inSeason={false} />)
    await waitFor(() => expect(screen.getByTestId('survivor-commissioner-checklist')).toBeTruthy())
    expect(screen.getByTestId('survivor-checklist-status').textContent).toBe('1 to do')
    expect(screen.getByTestId('survivor-checklist-seats').getAttribute('data-state')).toBe('todo')
    expect(screen.getByTestId('survivor-checklist-settings').getAttribute('data-state')).toBe('done')
  })

  it('in season it shows only this week\'s to-do, and nothing when nothing is needed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(dashboard), { status: 200 })))
    const { unmount } = render(<SurvivorCommissionerChecklist leagueId="L1" draftScheduled inSeason />)
    await waitFor(() => expect(screen.getByTestId('survivor-home-commissioner-todo')).toBeTruthy())
    expect(screen.queryByTestId('survivor-commissioner-checklist')).toBeNull()
    unmount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...dashboard, todo: { ...dashboard.todo, actionCount: 0 } }), { status: 200 })))
    render(<SurvivorCommissionerChecklist leagueId="L1" draftScheduled inSeason />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByTestId('survivor-home-commissioner-todo')).toBeNull()
  })

  it('a league with no Survivor config yet still renders the checklist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...dashboard, config: null }), { status: 200 })))
    render(<SurvivorCommissionerChecklist leagueId="L1" draftScheduled inSeason={false} />)
    await waitFor(() => expect(screen.getByTestId('survivor-commissioner-checklist')).toBeTruthy())
    expect(screen.getByTestId('survivor-checklist-idols').textContent).toContain('No idols this season.')
  })

  it('a non-commissioner gets a refusal and sees nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'no' }), { status: 403 })))
    render(<SurvivorCommissionerChecklist leagueId="L1" draftScheduled inSeason={false} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByTestId('survivor-commissioner-checklist')).toBeNull()
  })
})
