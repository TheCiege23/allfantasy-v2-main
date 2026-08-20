import { describe, expect, it } from 'vitest'
import { computeTimerStateWithPauseWindow } from '@/lib/live-draft-engine/DraftTimerService'

describe('computeTimerStateWithPauseWindow (draft timer contract)', () => {
  const now = new Date('2026-06-10T12:00:00.000Z')

  it('commissioner pause: never treats paused session as expired wall-clock', () => {
    const t = computeTimerStateWithPauseWindow(
      {
        status: 'paused',
        timerSeconds: 90,
        timerEndAt: new Date('2020-01-01'),
        pausedRemainingSeconds: 45,
      },
      now,
      null,
    )
    expect(t.status).toBe('paused')
    expect(t.pauseReason).toBe('commissioner')
  })

  it('overnight window with frozen seconds: paused overnight, not expired', () => {
    const pauseWindow = { start: '10:00', end: '14:00', timezone: 'UTC' }
    const t = computeTimerStateWithPauseWindow(
      {
        status: 'in_progress',
        timerSeconds: 90,
        timerEndAt: null,
        pausedRemainingSeconds: null,
        overnightFrozenPickSeconds: 42,
      },
      now,
      pauseWindow,
    )
    expect(t.status).toBe('paused')
    expect(t.pauseReason).toBe('overnight_window')
    expect(t.remainingSeconds).toBe(42)
  })

  it('in_progress with timerEndAt in past: expired (autopick gate may run)', () => {
    const t = computeTimerStateWithPauseWindow(
      {
        status: 'in_progress',
        timerSeconds: 90,
        timerEndAt: new Date('2020-01-01'),
        pausedRemainingSeconds: null,
      },
      now,
      null,
    )
    expect(t.status).toBe('expired')
  })

  it('in_progress with timerEndAt in future: running', () => {
    const t = computeTimerStateWithPauseWindow(
      {
        status: 'in_progress',
        timerSeconds: 90,
        timerEndAt: new Date('2030-01-01'),
        pausedRemainingSeconds: null,
      },
      now,
      null,
    )
    expect(t.status).toBe('running')
  })
})
