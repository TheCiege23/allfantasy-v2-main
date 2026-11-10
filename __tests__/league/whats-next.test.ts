import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORMAT_GUIDES } from '@/lib/league/whats-next/formatPhaseGuides'
import { fillTemplate, resolveWhatsNext } from '@/lib/league/whats-next/resolveWhatsNext'
import {
  bigBrotherFacts,
  guillotineFacts,
  lifecycleFacts,
  pirateFacts,
  survivorFacts,
  whatsNextFormatFor,
  zombieFacts,
} from '@/lib/league/whats-next/adapters'
import { FORMAT_WALKTHROUGHS } from '@/lib/league/whats-next/formatWalkthroughs'
import type { WhatsNextFacts, WhatsNextFormatId } from '@/lib/league/whats-next/types'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const LATER = '2026-11-11T18:00:00.000Z'

/**
 * The engine's own phase union, read from source: a phase added to BigBrotherWeekPhase without a
 * guide here would otherwise render no banner at all, silently.
 */
function bigBrotherWeekPhases(): string[] {
  const src = readFileSync(path.join(process.cwd(), 'lib/big-brother/types.ts'), 'utf8')
  const block = src.match(/export type BigBrotherWeekPhase =([\s\S]*?)\r?\n\r?\n/)
  expect(block, 'BigBrotherWeekPhase union not found').not.toBeNull()
  return [...block![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
}

describe('phase config', () => {
  it('covers every Big Brother week phase the engine can store', () => {
    const phases = bigBrotherWeekPhases()
    expect(phases.length).toBeGreaterThanOrEqual(13)
    for (const phase of phases) expect(FORMAT_GUIDES.big_brother.phases[phase], phase).toBeDefined()
  })

  it('gives every phase of every format copy for all three audiences, with no raw placeholder left', () => {
    for (const [format, guide] of Object.entries(FORMAT_GUIDES)) {
      for (const [phase, g] of Object.entries(guide.phases)) {
        const label = `${format}.${phase}`
        expect(g.title, label).toBeTruthy()
        expect(g.commissionerMessage, label).toBeTruthy()
        expect(g.memberMessage, label).toBeTruthy()
        if (g.actor === 'viewer_decides' || g.actor === 'commissioner') expect(g.actorMessage, label).toBeTruthy()
        if (g.actor === 'viewer_decides') expect(g.action, `${label} needs a button for the manager who acts`).toBeDefined()

        // Every audience, with NO vars at all: fallbacks must cover every placeholder.
        const facts: WhatsNextFacts = { format: format as WhatsNextFormatId, phase }
        for (const viewer of [{ isCommissioner: true }, { isCommissioner: false }]) {
          for (const extra of [{}, { viewerIsActor: true }, { viewerIsInvolved: true }]) {
            const view = resolveWhatsNext({ ...facts, ...extra }, viewer)!
            for (const text of [view.title, view.message, view.waitingOn ?? '', view.commissionerNote ?? '', view.action?.label ?? '']) {
              expect(text, `${label}: "${text}"`).not.toMatch(/[{}]/)
            }
          }
        }
      }
    }
  })

  it('has a 3–5 step walkthrough for every format except plain redraft', () => {
    for (const format of Object.keys(FORMAT_GUIDES) as WhatsNextFormatId[]) {
      if (format === 'redraft') continue
      const w = FORMAT_WALKTHROUGHS[format]
      expect(w, format).toBeDefined()
      expect(w!.steps.length, format).toBeGreaterThanOrEqual(3)
      expect(w!.steps.length, format).toBeLessThanOrEqual(5)
    }
  })
})

describe('fillTemplate', () => {
  it('drops a "Week {week}" with no week rather than printing "Week :"', () => {
    expect(fillTemplate('Week {week}: the HOH competition is on', {})).toBe('The HOH competition is on')
    expect(fillTemplate('Playoffs: Week {week}', {})).toBe('Playoffs')
    expect(fillTemplate('Week {week} is over', { week: '4' })).toBe('Week 4 is over')
  })
})

// ── Big Brother: the case the feedback was about ─────────────────────────────────────────────

function bbSummary(phase: string, { cycle: cycleOver, ...over }: Record<string, unknown> = {}) {
  return {
    cycle: {
      id: 'c1', week: 3, phase,
      hohRosterId: 'mike', nominee1RosterId: 'ann', nominee2RosterId: 'bo',
      vetoWinnerRosterId: null, vetoParticipantRosterIds: ['mike', 'ann', 'bo', 'cy'], vetoUsed: false,
      vetoSavedRosterId: null, replacementNomineeRosterId: null, evictedRosterId: null,
      voteDeadlineAt: LATER, voteOpenedAt: null, closedAt: null,
      ...(cycleOver as object),
    },
    finalNomineeRosterIds: [],
    jury: [], finalists: [],
    ballot: null,
    myRosterId: 'me',
    myStatus: 'SAFE',
    rosterDisplayNames: { mike: 'Mike', ann: 'Ann', bo: 'Bo', cy: 'Cy', me: 'Me' },
    ...over,
  }
}

describe('Big Brother', () => {
  it('after HOH is chosen, tells everyone else to wait on the HOH by name', () => {
    const view = resolveWhatsNext(bigBrotherFacts(bbSummary('NOMINATION_OPEN'), NOW)!, { isCommissioner: false })!
    expect(view.title).toBe('HOH has been chosen: Mike')
    expect(view.status).toBe('wait')
    expect(view.message).toBe('Waiting on Mike (HOH) to nominate 2 houseguests. Nothing to do yet.')
    expect(view.waitingOn).toBe('Mike (HOH)')
    expect(view.action).toBeNull()
  })

  it('tells the HOH it is their turn, with a button to nominations', () => {
    const view = resolveWhatsNext(bigBrotherFacts(bbSummary('NOMINATION_OPEN', { myRosterId: 'mike' }), NOW)!, { isCommissioner: false })!
    expect(view.status).toBe('act')
    expect(view.message).toBe('Your turn: nominate 2 houseguests for eviction.')
    expect(view.action).toEqual({ tab: 'bb_hoh', label: 'Make nominations' })
    expect(view.waitingOn).toBeNull()
    expect(view.shared).toBe(false) // the league is waiting on this manager: "Your turn"
  })

  it('gives the commissioner the fallback rule, not the member line', () => {
    const view = resolveWhatsNext(bigBrotherFacts(bbSummary('NOMINATION_OPEN'), NOW)!, { isCommissioner: true })!
    expect(view.role).toBe('commissioner')
    expect(view.message).toMatch(/fallback rule nominates/)
  })

  it('asks a voter to vote and tells a nominee they are on the block', () => {
    const voter = bigBrotherFacts(bbSummary('VOTING_OPEN', { ballot: { canVote: true, voteDeadlineAt: LATER, closed: false } }), NOW)!
    const v = resolveWhatsNext(voter, { isCommissioner: false })!
    expect(v.status).toBe('act')
    expect(v.action?.tab).toBe('bb_voting')
    expect(v.deadlineIso).toBe(LATER)

    const nominee = resolveWhatsNext(bigBrotherFacts(bbSummary('VOTING_OPEN', { myRosterId: 'ann' }), NOW)!, { isCommissioner: false })!
    expect(nominee.role).toBe('involved')
    expect(nominee.message).toMatch(/^You're on the block/)
  })

  it('names the veto holder and hands them the decision', () => {
    const s = bbSummary('VETO_DECISION_OPEN', { cycle: { vetoWinnerRosterId: 'cy' } })
    expect(resolveWhatsNext(bigBrotherFacts(s, NOW)!, { isCommissioner: false })!.title).toBe('Cy won the Power of Veto')
    const holder = resolveWhatsNext(bigBrotherFacts({ ...s, myRosterId: 'cy' }, NOW)!, { isCommissioner: false })!
    expect(holder.status).toBe('act')
    expect(holder.action?.tab).toBe('bb_veto')
  })

  it('before the first week, waits on the commissioner and gives them Big Brother command', () => {
    const facts = bigBrotherFacts({ cycle: null, rosterDisplayNames: {} }, NOW)!
    expect(facts.phase).toBe('PRE_SEASON')
    expect(resolveWhatsNext(facts, { isCommissioner: true })!.action?.tab).toBe('bb_command')
    expect(resolveWhatsNext(facts, { isCommissioner: false })!.waitingOn).toBe('The commissioner')
  })

  it('automatic phases never tell anyone it is their turn', () => {
    for (const phase of ['HOH_OPEN', 'VETO_DRAW', 'VOTING_LOCKED', 'EVICTION_RESOLVED']) {
      const view = resolveWhatsNext(bigBrotherFacts(bbSummary(phase, { myRosterId: 'mike' }), NOW)!, { isCommissioner: false })!
      expect(view.status, phase).toBe('wait')
    }
  })
})

// ── Other formats ────────────────────────────────────────────────────────────────────────────

describe('Survivor', () => {
  const base = {
    currentWeek: 4, merged: false, myRosterId: 'me', myTribeId: 't1',
    tribes: [{ id: 't1', name: 'Tagi', members: [] }, { id: 't2', name: 'Pagong', members: [] }],
    challenges: [], jury: [], votedOutHistory: [], exileLeagueId: null, rosterDisplayNames: {},
  }
  it('sends the attending tribe to vote and tells the other tribe it is safe', () => {
    const council = { id: 'k', week: 4, phase: 'pre_merge', attendingTribeId: 't1', voteDeadlineAt: LATER, closedAt: null }
    const mine = resolveWhatsNext(survivorFacts({ ...base, council }, NOW)!, { isCommissioner: false })!
    expect(mine.status).toBe('act')
    expect(mine.title).toBe('Tribal Council: Tagi is voting')
    const other = resolveWhatsNext(survivorFacts({ ...base, myTribeId: 't2', council }, NOW)!, { isCommissioner: false })!
    expect(other.status).toBe('wait')
    expect(other.message).toMatch(/You are safe this round/)
  })
  it('marks a juror who has voted as done', () => {
    const finale = { open: true, closed: false, finalists: [{ rosterId: 'a' }], juryVotesSubmitted: 3, juryVotesRequired: 7, winnerRosterId: null, myJuryVote: { finalistRosterId: 'a', submittedAt: LATER } }
    const view = resolveWhatsNext(survivorFacts({ ...base, council: null, jury: [{ rosterId: 'me', votedOutWeek: 6 }], finale }, NOW)!, { isCommissioner: false })!
    expect(view.status).toBe('done')
  })
})

describe('Zombie, Guillotine, Pirate', () => {
  it('Zombie advice follows the viewer’s role', () => {
    const view = resolveWhatsNext(zombieFacts({ league: { status: 'active' }, week: 5, survivors: [1, 2, 3], myStatus: 'Zombie' })!, { isCommissioner: false })!
    expect(view.title).toBe('Week 5: 3 survivors left')
    expect(view.message).toMatch(/You're a zombie/)
  })
  it('Guillotine warns a team on the chop line', () => {
    const tiers = [{ rosterId: 'me', tier: 'chop_zone', pointsFromChopZone: 0 }, { rosterId: 'x', tier: 'safe', pointsFromChopZone: 12 }]
    const view = resolveWhatsNext(guillotineFacts({ weekOrPeriod: 6, dangerTiers: tiers, myRosterId: 'me', home: { aliveCount: 8 }, config: { eliminationStartWeek: 2, teamsPerChop: 1 } }, NOW)!, { isCommissioner: false })!
    expect(view.message).toMatch(/on the chop line/)
  })
  it('Pirate hands the winning manager the claim', () => {
    const payload = { week: 3, myRosterId: 'w', rosters: [{ id: 'w', name: 'Wolves' }, { id: 'l', name: 'Lambs' }], claims: [{ status: 'awaiting_selection', winnerRosterId: 'w', loserRosterId: 'l', selectionDeadlineAt: LATER }] }
    const view = resolveWhatsNext(pirateFacts(payload, NOW)!, { isCommissioner: false })!
    expect(view.status).toBe('act')
    expect(view.message).toBe('Your turn: you won your matchup. Choose the player you take from Lambs.')
  })
})

describe('season lifecycle', () => {
  it('counts down to a scheduled draft', () => {
    const facts = lifecycleFacts('redraft', { id: 'L1', lifecycleState: 'pre_draft' }, LATER, NOW)
    expect(facts.phase).toBe('draft_scheduled')
    expect(facts.deadlineIso).toBe(LATER)
    // Every manager gets ready for the draft, so it is a shared task ("To do"), not "Your turn".
    expect(resolveWhatsNext(facts, { isCommissioner: false })!.shared).toBe(true)
  })
  it('links a live draft to the draft room', () => {
    const view = resolveWhatsNext(lifecycleFacts('dynasty', { id: 'L 1', lifecycleState: 'drafting' }, null, NOW), { isCommissioner: false })!
    expect(view.action?.href).toBe('/league/L%201/draft')
  })
  it('does not tell a non-playing host to set a lineup', () => {
    const view = resolveWhatsNext(lifecycleFacts('redraft', { id: 'L', lifecycleState: 'in_season', currentWeek: 5 }, null, NOW), { isCommissioner: true, hasTeam: false })!
    expect(view.role).toBe('commissioner')
  })
})

describe('whatsNextFormatFor', () => {
  it('maps every league shape to its guide', () => {
    expect(whatsNextFormatFor({ leagueType: 'big_brother' })).toBe('big_brother')
    expect(whatsNextFormatFor({ leagueVariant: 'survivor' })).toBe('survivor')
    expect(whatsNextFormatFor({ leagueVariant: 'zombie' })).toBe('zombie')
    expect(whatsNextFormatFor({ guillotineMode: true })).toBe('guillotine')
    expect(whatsNextFormatFor({ leagueType: 'pirate' })).toBe('pirate')
    expect(whatsNextFormatFor({ leagueVariant: 'tournament_mode' })).toBe('tournament')
    expect(whatsNextFormatFor({ bestBallMode: true })).toBe('best_ball')
    expect(whatsNextFormatFor({ leagueVariant: 'merged_devy_c2c' })).toBe('c2c')
    expect(whatsNextFormatFor({ leagueVariant: 'devy_dynasty' })).toBe('devy')
    expect(whatsNextFormatFor({ leagueType: 'salary_cap' })).toBe('salary_cap')
    expect(whatsNextFormatFor({ leagueVariant: 'DYNASTY_IDP' })).toBe('idp')
    expect(whatsNextFormatFor({ leagueType: 'keeper' })).toBe('keeper')
    expect(whatsNextFormatFor({ isDynasty: true })).toBe('dynasty')
    expect(whatsNextFormatFor({ leagueType: 'redraft' })).toBe('redraft')
  })
})
