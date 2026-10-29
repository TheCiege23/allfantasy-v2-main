// @vitest-environment node
/** "Your status" on the island home: where the viewer stands this week and what they can do now. */
import { describe, expect, it } from 'vitest'

import { buildSurvivorStatusCard } from '@/lib/survivor/survivorStatusCard'
import type { SurvivorSeasonPayload } from '@/lib/survivor/survivorUiTypes'

const now = Date.parse('2026-10-20T12:00:00Z')
const formatTime = (at: Date) => at.toISOString().slice(11, 16)
const me = { userId: 'u1', displayName: 'Ava', tribeId: 't1', playerState: 'active', idolIds: [] as string[] }
const season = (over: Partial<SurvivorSeasonPayload> = {}, user: Record<string, unknown> = {}): SurvivorSeasonPayload => ({
  phase: 'pre_merge',
  tribes: [{ id: 't1', name: 'Tala' }, { id: 't2', name: 'Moto' }],
  userState: { ...me, ...user } as never,
  ...over,
})
const card = (s: SurvivorSeasonPayload, flags: { canVote?: boolean; canSubmitChallenge?: boolean } = {}) =>
  buildSurvivorStatusCard({ season: s, canVote: flags.canVote ?? false, canSubmitChallenge: flags.canSubmitChallenge ?? false, base: '/survivor/L1', now, formatTime })!

describe('buildSurvivorStatusCard', () => {
  it('is empty for a viewer who is not in the cast', () => {
    expect(buildSurvivorStatusCard({ season: { ...season(), userState: null }, canVote: false, canSubmitChallenge: false, base: '/s', now })).toBeNull()
  })

  it('at Tribal Council: at risk, the deadline, and vote plus idol actions', () => {
    const c = card(season({ activeCouncil: { id: 'c', week: 6, status: 'voting_open', attendingTribeId: 't1', voteDeadlineAt: '2026-10-21T00:00:00Z' } }, { idolIds: ['i1'] }), { canVote: true })
    expect(c.tone).toBe('risk')
    expect(c.headline).toBe('Your tribe is at Tribal Council')
    expect(c.facts).toEqual([{ label: 'Tribe', value: 'Tala' }, { label: 'Idols', value: 'You hold 1' }, { label: 'Votes close', value: '00:00 (in 12h 0m)' }])
    expect(c.actions.map(a => a.label)).toEqual(['Vote now', 'Play an idol'])
  })

  it('another tribe at council: safe this week', () => {
    const c = card(season({ activeCouncil: { id: 'c', week: 6, status: 'voting_open', attendingTribeId: 't2' } }))
    expect(c.tone).toBe('safe')
    expect(c.headline).toBe('Your tribe is safe this week')
  })

  it('after the merge everyone attends; individual immunity wins', () => {
    const open = { activeCouncil: { id: 'c', week: 9, status: 'voting_open', attendingTribeId: null }, phase: 'merge' }
    expect(card(season(open), { canVote: true }).headline).toBe('Tribal Council is open')
    expect(card(season(open, { hasImmunityThisWeek: true })).tone).toBe('immune')
    expect(card(season(open)).facts[0]).toEqual({ label: 'Tribe', value: 'Merged: everyone plays for themselves' })
  })

  it('an open challenge with no council asks for the pick', () => {
    const c = card(season({ currentChallenge: { id: 'ch', week: 6, status: 'open', locksAt: '2026-10-20T18:30:00Z' } }), { canSubmitChallenge: true })
    expect(c.headline).toBe('A challenge is open')
    expect(c.facts).toContainEqual({ label: 'Challenge locks', value: '18:30 (in 6h 30m)' })
    expect(c.actions).toEqual([{ label: 'Make your challenge pick', href: '/survivor/L1/challenges' }])
  })

  it('a quiet week says there is nothing to do', () => {
    const c = card(season())
    expect(c.headline).toBe('Nothing to do right now')
    expect(c.actions).toEqual([])
  })

  it('Exile shows tokens; the jury, the finale and the eliminated each get their own card', () => {
    const exile = card(season({}, { playerState: 'exile', tokenBalance: 2 }))
    expect(exile.tone).toBe('exile')
    expect(exile.facts).toContainEqual({ label: 'Tokens', value: '2' })
    expect(exile.facts.find(f => f.label === 'Idols')).toBeUndefined()
    expect(card(season({}, { playerState: 'jury', isJuryMember: true })).actions[0].href).toBe('/survivor/L1/jury')
    expect(card(season({}, { isFinalist: true })).tone).toBe('finalist')
    expect(card(season({}, { playerState: 'eliminated' })).tone).toBe('out')
  })
})
