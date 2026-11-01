// @vitest-environment node
/**
 * The final jury step — "add one more person to the jury" after the last immunity (closest without
 * going over). Pure rule, settings, rules copy, and the idempotent server step.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  finalJuryStepAnnouncement,
  finalJuryStepDueAt,
  finalJuryStepRulesLine,
  finalJuryStepSkipsCouncil,
  planFinalJuryStep,
  rankFinalJuryStep,
  type FinalJuryStepChallenge,
} from '@/lib/survivor/survivorFinalJuryStep'
import {
  finaleSettingsLockedAfterFinaleStart,
  readSurvivorFinaleSettings,
  SURVIVOR_FINALE_DEFAULTS,
  validateFinaleWindowsPatch,
  validateSurvivorFinaleSettingsPatch,
  EMPTY_FINALE_WINDOWS,
} from '@/lib/survivor/survivorFinaleSettings'
import { answerSurvivorRules } from '@/lib/survivor/survivorRulesAnswers'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'

const ON = { finalJuryStepEnabled: true, finalJuryStepCount: 1 }
const t = (min: number) => new Date(Date.UTC(2026, 11, 20, 18, min)).toISOString()

function challenge(over: Partial<FinalJuryStepChallenge> = {}): FinalJuryStepChallenge {
  return {
    challengeId: 'c-final',
    target: 47,
    immunityRosterIds: ['r1'],
    // r1 45 (winner), r2 40, r3 52 (over), r4 did not answer.
    entries: [
      { userId: 'r1', guess: 45, submittedAt: t(1) },
      { userId: 'r2', guess: 40, submittedAt: t(2) },
      { userId: 'r3', guess: 52, submittedAt: t(3) },
    ],
    ...over,
  }
}

describe('final jury step: the rule', () => {
  it('defaults off, so an existing league plays as before', () => {
    expect(SURVIVOR_FINALE_DEFAULTS.finalJuryStepEnabled).toBe(false)
    expect(readSurvivorFinaleSettings({})).toMatchObject({ finalJuryStepEnabled: false, finalJuryStepCount: 1 })
    expect(planFinalJuryStep({ settings: readSurvivorFinaleSettings({}), finalistCount: 3, merged: true, applied: false, activeRosterIds: ['r1', 'r2', 'r3', 'r4'], challenge: challenge() })).toEqual({ status: 'off' })
  })

  it('is due at finalists + extra jurors, and waits for the final immunity to settle', () => {
    expect(finalJuryStepDueAt(ON, 3)).toBe(4)
    expect(planFinalJuryStep({ settings: ON, finalistCount: 3, merged: true, applied: false, activeRosterIds: ['r1', 'r2', 'r3', 'r4', 'r5'], challenge: challenge() })).toEqual({ status: 'not_due', active: 5, dueAt: 4 })
    expect(planFinalJuryStep({ settings: ON, finalistCount: 3, merged: false, applied: false, activeRosterIds: ['r1', 'r2', 'r3', 'r4'], challenge: challenge() }).status).toBe('not_due')
    expect(planFinalJuryStep({ settings: ON, finalistCount: 3, merged: true, applied: false, activeRosterIds: ['r1', 'r2', 'r3', 'r4'], challenge: null })).toEqual({ status: 'awaiting_immunity', dueAt: 4 })
    expect(planFinalJuryStep({ settings: ON, finalistCount: 3, merged: true, applied: false, activeRosterIds: ['r1', 'r2', 'r3', 'r4'], challenge: challenge({ target: null }) }).status).toBe('awaiting_immunity')
  })

  it('sends the worst finisher to the jury: a non-answer ranks below an over-guess', () => {
    const plan = planFinalJuryStep({ settings: ON, finalistCount: 3, merged: true, applied: false, activeRosterIds: ['r1', 'r2', 'r3', 'r4'], challenge: challenge() })
    expect(plan).toEqual({ status: 'apply', challengeId: 'c-final', immuneRosterId: 'r1', ranking: ['r1', 'r2', 'r3', 'r4'], cutRosterIds: ['r4'] })
  })

  it('takes two when the commissioner asks for two, and never cuts the immunity winner', () => {
    // The immunity winner is r3 here (e.g. the commissioner settled by hand): safe even though ranked low.
    const plan = planFinalJuryStep({ settings: { finalJuryStepEnabled: true, finalJuryStepCount: 2 }, finalistCount: 2, merged: true, applied: false, activeRosterIds: ['r1', 'r2', 'r3', 'r4'], challenge: challenge({ immunityRosterIds: ['r3'] }) })
    expect(plan.status).toBe('apply')
    if (plan.status !== 'apply') return
    expect(plan.cutRosterIds).toEqual(['r2', 'r4'])
    expect(plan.cutRosterIds).not.toContain('r3')
  })

  it('is applied once: a second run is done', () => {
    expect(planFinalJuryStep({ settings: ON, finalistCount: 3, merged: true, applied: true, activeRosterIds: ['r1', 'r2', 'r3', 'r4'], challenge: challenge() })).toEqual({ status: 'done' })
  })

  it('ranks only the cast still in the game, deterministically', () => {
    expect(rankFinalJuryStep(['r4', 'r3'], challenge())).toEqual(['r3', 'r4'])
    expect(rankFinalJuryStep(['r9', 'r8'], challenge({ target: null }))).toEqual(['r8', 'r9'])
  })

  it('holds planned Tribals once the cast is down to the step’s size', () => {
    expect(finalJuryStepSkipsCouncil(ON, { finalistCount: 3, activeCount: 4, merged: true, applied: false })).toBe(true)
    expect(finalJuryStepSkipsCouncil(ON, { finalistCount: 3, activeCount: 5, merged: true, applied: false })).toBe(false)
    expect(finalJuryStepSkipsCouncil(ON, { finalistCount: 3, activeCount: 3, merged: true, applied: false })).toBe(false)
    expect(finalJuryStepSkipsCouncil({ ...ON, finalJuryStepEnabled: false }, { finalistCount: 3, activeCount: 4, merged: true, applied: false })).toBe(false)
    expect(finalJuryStepSkipsCouncil(ON, { finalistCount: 3, activeCount: 4, merged: false, applied: false })).toBe(false)
  })
})

describe('final jury step: commissioner settings', () => {
  it('validates the toggle and the count, in English and Spanish', () => {
    expect(validateSurvivorFinaleSettingsPatch({ finalJuryStepEnabled: true, finalJuryStepCount: 2 })).toEqual({ ok: true, patch: { finalJuryStepEnabled: true, finalJuryStepCount: 2 } })
    expect(validateSurvivorFinaleSettingsPatch({ finalJuryStepCount: 3 })).toMatchObject({ ok: false, error: expect.stringContaining('from 1 to 2') })
    expect(validateSurvivorFinaleSettingsPatch({ finalJuryStepCount: 3 }, 'es')).toMatchObject({ ok: false, error: expect.stringContaining('de 1 a 2') })
    expect(validateSurvivorFinaleSettingsPatch({ finalJuryStepEnabled: 'yes' }, 'es')).toEqual({ ok: false, error: 'finalJuryStepEnabled debe ser verdadero o falso.' })
    expect(validateSurvivorFinaleSettingsPatch({}, 'es')).toEqual({ ok: false, error: 'La solicitud no trae reglas de la final.' })
    expect(validateFinaleWindowsPatch({}, EMPTY_FINALE_WINDOWS, new Date(), 'es')).toEqual({ ok: false, error: 'La solicitud no trae plazos de la final.' })
    expect(readSurvivorFinaleSettings({ finalJuryStepCount: 9 }).finalJuryStepCount).toBe(2)
  })

  it('locks the step once the finale starts (the route enforces it)', () => {
    const current = readSurvivorFinaleSettings({})
    expect(finaleSettingsLockedAfterFinaleStart({ finalJuryStepEnabled: true }, current)).toEqual(['finalJuryStepEnabled'])
    expect(finaleSettingsLockedAfterFinaleStart({ reunionChatEnabled: false }, current)).toEqual([])
  })
})

describe('final jury step: Chimmy explains it', () => {
  const base = { sport: 'NFL', settings: normalizeSurvivorFoundationSettings({}), plan: null }
  it('names the step in the jury answer only when it is on, EN and ES', () => {
    const off = answerSurvivorRules('jury', { ...base, finale: SURVIVOR_FINALE_DEFAULTS })
    expect(off).not.toContain('one more person joins the jury')
    const on = answerSurvivorRules('jury', { ...base, finale: { ...SURVIVOR_FINALE_DEFAULTS, ...ON } })
    expect(on).toContain('one more person joins the jury')
    const es = answerSurvivorRules('jury', { ...base, language: 'es', finale: { ...SURVIVOR_FINALE_DEFAULTS, ...ON } })
    expect(es.split('\n')[0]).toBe('**Jurado y final**')
    expect(es).toContain('una persona más se une al jurado')
    expect(es).not.toMatch(/Managers voted out|Final Tribal Council/)
  })

  it('the copy and announcement read right in both languages', () => {
    expect(finalJuryStepRulesLine({ finalJuryStepEnabled: false, finalJuryStepCount: 1 })).toBeNull()
    expect(finalJuryStepRulesLine({ finalJuryStepEnabled: true, finalJuryStepCount: 2 })).toContain('2 more people join the jury')
    expect(finalJuryStepAnnouncement(['Ann'])).toBe('After the last immunity, Ann joins the jury. Everyone else goes to the finale.')
    expect(finalJuryStepAnnouncement(['Ann', 'Bo'], 'es')).toBe('Tras la última inmunidad, Ann y Bo se unen al jurado. Los demás pasan a la final.')
  })
})

// ── The server step ────────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const state = { applied: false, settings: {} as Record<string, unknown>, phase: 'merge' }
  const tx = {
    survivorAuditEntry: { findFirst: vi.fn(async () => (state.applied ? { id: 'a' } : null)), create: vi.fn(async (args: { data: { action: string } }) => { if (args.data.action === 'final_jury_step_applied') state.applied = true; return {} }) },
    survivorPlayer: { updateMany: vi.fn(async () => ({ count: 1 })), count: vi.fn(async () => 3) },
    survivorJuryMember: { upsert: vi.fn(async () => ({})) },
    survivorChatChannel: { findMany: vi.fn(async () => [{ id: 'merge', memberUserIds: ['u1', 'u2', 'u3', 'u4'] }]), update: vi.fn(async () => ({})) },
    survivorGameState: { updateMany: vi.fn(async () => ({ count: 1 })) },
  }
  const db = {
    league: { findUnique: vi.fn(async () => ({ settings: state.settings, survivorFinal3: true, language: 'en' })) },
    survivorGameState: { findUnique: vi.fn(async () => ({ phase: state.phase })) },
    survivorPlayer: { findMany: vi.fn(async () => ['1', '2', '3', '4'].map((n) => ({ userId: `u${n}`, displayName: `P${n}`, redraftRosterId: `r${n}` }))) },
    survivorAuditEntry: { findFirst: vi.fn(async () => (state.applied ? { id: 'a' } : null)) },
    survivorChallenge: { findMany: vi.fn(async () => [{ id: 'c-final', configJson: { builder: 1, kind: 'closest_without_going_over', scope: 'individual', opensAt: '', locksAt: '' }, resultJson: { outcome: 'settled', truth: { value: 47 }, immunityRosterIds: ['r1'] } }]) },
    survivorChallengeSubmission: { findMany: vi.fn(async () => [
      { rosterId: 'r1', submission: { answer: { value: 45 } }, submittedAt: new Date(t(1)) },
      { rosterId: 'r2', submission: { answer: { value: 40 } }, submittedAt: new Date(t(2)) },
      { rosterId: 'r3', submission: { answer: { value: 52 } }, submittedAt: new Date(t(3)) },
    ]) },
    survivorChatChannel: { findFirst: vi.fn(async () => ({ id: 'league-ch' })) },
  }
  return { state, tx, db, chat: vi.fn(async () => ({})) }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: async (_l: string, fn: (tx: typeof h.tx) => unknown) => fn(h.tx) }))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({ createSurvivorChatMessage: h.chat }))

import { applyFinalJuryStepIfDue, finalJuryStepHoldsCouncil } from '@/lib/survivor/survivorFinalJuryStepService'

describe('applyFinalJuryStepIfDue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.state.applied = false
    h.state.phase = 'merge'
    h.state.settings = { finalJuryStepEnabled: true, finalJuryStepCount: 1, finalistCount: 3 }
  })

  it('is a no-op while the setting is off', async () => {
    h.state.settings = {}
    expect(await applyFinalJuryStepIfDue('L1', 17)).toBe('off')
    expect(h.tx.survivorJuryMember.upsert).not.toHaveBeenCalled()
  })

  it('sends the worst finisher to the jury once, names only them, and a re-run changes nothing', async () => {
    expect(await applyFinalJuryStepIfDue('L1', 17)).toBe('applied')
    expect(h.tx.survivorJuryMember.upsert).toHaveBeenCalledTimes(1)
    expect(h.tx.survivorJuryMember.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { leagueId: 'L1', rosterId: 'r4', votedOutWeek: 17 } }))
    expect(h.tx.survivorPlayer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', userId: 'u4', playerState: 'active' }, data: expect.objectContaining({ isJuryMember: true, canAccessJuryChat: true, playerState: 'eliminated' }) }))
    expect(h.tx.survivorChatChannel.update).toHaveBeenCalledWith({ where: { id: 'merge' }, data: { memberUserIds: ['u1', 'u2', 'u3'] } })
    const line = (h.chat.mock.calls[0] as unknown as [unknown, { data: { content: string } }])[1].data.content
    expect(line).toBe('After the last immunity, P4 joins the jury. Everyone else goes to the finale.')
    expect(line).not.toContain('P1') // the immunity winner is never named
    expect(await applyFinalJuryStepIfDue('L1', 17)).toBe('done')
    expect(h.tx.survivorJuryMember.upsert).toHaveBeenCalledTimes(1)
  })

  it('waits for the final immunity, and holds planned Tribals at the step size', async () => {
    h.db.survivorChallenge.findMany.mockResolvedValueOnce([])
    expect(await applyFinalJuryStepIfDue('L1', 17)).toBe('awaiting_immunity')
    expect(await finalJuryStepHoldsCouncil('L1')).toBe(true)
    h.state.phase = 'pre_merge'
    expect(await finalJuryStepHoldsCouncil('L1')).toBe(false)
  })
})
