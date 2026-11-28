/**
 * Pre-draft countdown to the scheduled start (2026-11): the pure seconds → label logic in
 * lib/draft/scheduledStartCountdown.ts, and where the top bar puts it.
 */
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const value = () => {
    const t = (key: string) => dict.en[key] ?? key
    return { language: 'en', setLanguage: () => {}, t, tInterpolate: (key: string) => t(key) }
  }
  return { useLanguage: value, useOptionalLanguage: value }
})
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    <img alt={String(props.alt ?? '')} src={String(props.src ?? '')} data-testid={props['data-testid'] as string | undefined} />
  ),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import {
  SCHEDULED_START_GRACE_MS,
  formatScheduledStartRemaining,
  resolveScheduledStartCountdown,
  scheduledDraftAutoStarts,
} from '@/lib/draft/scheduledStartCountdown'
import { translations } from '@/lib/i18n/translations'

const NOW = Date.parse('2026-11-25T18:00:00.000Z')
const iso = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1000).toISOString()

describe('formatScheduledStartRemaining', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatScheduledStartRemaining(0)).toBe('0:00')
    expect(formatScheduledStartRemaining(45)).toBe('0:45')
    expect(formatScheduledStartRemaining(754)).toBe('12:34')
    expect(formatScheduledStartRemaining(3599)).toBe('59:59')
  })

  it('switches to hours and zero-padded minutes from one hour', () => {
    expect(formatScheduledStartRemaining(3600)).toBe('1h 00m')
    expect(formatScheduledStartRemaining(2 * 3600 + 5 * 60 + 59)).toBe('2h 05m')
    expect(formatScheduledStartRemaining(86399)).toBe('23h 59m')
  })

  it('switches to days and hours from 24 hours', () => {
    expect(formatScheduledStartRemaining(86400)).toBe('1d 0h')
    expect(formatScheduledStartRemaining(3 * 86400 + 4 * 3600 + 3599)).toBe('3d 4h')
  })

  it('never renders a negative or non-finite number', () => {
    expect(formatScheduledStartRemaining(-30)).toBe('0:00')
    expect(formatScheduledStartRemaining(Number.NaN)).toBe('0:00')
    expect(formatScheduledStartRemaining(12.9)).toBe('0:12')
  })
})

describe('resolveScheduledStartCountdown', () => {
  const base = { draftStatus: 'pre_draft', nowMs: NOW, autoStarts: true }

  it('counts down before the scheduled time', () => {
    expect(resolveScheduledStartCountdown({ ...base, scheduledStartIso: iso(754) })).toEqual({
      phase: 'counting',
      remainingSeconds: 754,
      time: '12:34',
    })
  })

  it('uses the ticking seconds it is handed, and ignores a stale zero while time is left', () => {
    expect(resolveScheduledStartCountdown({ ...base, scheduledStartIso: iso(754), remainingSeconds: 753 })).toMatchObject({
      phase: 'counting',
      time: '12:33',
    })
    expect(resolveScheduledStartCountdown({ ...base, scheduledStartIso: iso(754), remainingSeconds: 0 })).toMatchObject({
      phase: 'counting',
      time: '12:34',
    })
  })

  it('shows nothing without a time, with an unreadable time, or outside pre-draft', () => {
    expect(resolveScheduledStartCountdown({ ...base, scheduledStartIso: null })).toEqual({ phase: 'none' })
    expect(resolveScheduledStartCountdown({ ...base, scheduledStartIso: 'not a date' })).toEqual({ phase: 'none' })
    expect(resolveScheduledStartCountdown({ ...base, draftStatus: 'in_progress', scheduledStartIso: iso(754) })).toEqual({ phase: 'none' })
    expect(resolveScheduledStartCountdown({ ...base, draftStatus: 'completed', scheduledStartIso: iso(-5) })).toEqual({ phase: 'none' })
  })

  it('says "starting" once the time has passed, only when the server starts the draft, and only for the grace window', () => {
    expect(resolveScheduledStartCountdown({ ...base, scheduledStartIso: iso(0) })).toEqual({ phase: 'starting' })
    expect(resolveScheduledStartCountdown({ ...base, scheduledStartIso: iso(-90) })).toEqual({ phase: 'starting' })
    expect(resolveScheduledStartCountdown({ ...base, scheduledStartIso: iso(-90), autoStarts: false })).toEqual({ phase: 'none' })
    expect(
      resolveScheduledStartCountdown({ ...base, scheduledStartIso: iso(-(SCHEDULED_START_GRACE_MS / 1000) - 1) }),
    ).toEqual({ phase: 'none' })
  })
})

describe('scheduledDraftAutoStarts', () => {
  const native = { platform: null, survivorMode: false, guillotineMode: false, leagueVariant: null }

  it('is true for a native redraft league in a scheduled sport, whatever the toggle says', () => {
    expect(scheduledDraftAutoStarts(false, { ...native, sport: 'NFL', leagueType: 'redraft', isDynasty: false })).toBe(true)
  })

  it('follows the Autostart toggle for dynasty, devy, C2C, Survivor and Guillotine leagues', () => {
    const dynasty = { ...native, sport: 'NFL', leagueType: 'dynasty', isDynasty: true }
    expect(scheduledDraftAutoStarts(true, dynasty)).toBe(true)
    expect(scheduledDraftAutoStarts(false, dynasty)).toBe(false)
    expect(scheduledDraftAutoStarts(true, { ...native, sport: 'NFL', leagueType: 'c2c', isDynasty: false })).toBe(true)
    expect(scheduledDraftAutoStarts(true, { ...native, sport: 'NFL', leagueType: 'redraft', isDynasty: false, survivorMode: true })).toBe(true)
    expect(scheduledDraftAutoStarts(false, { ...native, sport: 'NFL', leagueType: 'redraft', isDynasty: false, guillotineMode: true })).toBe(false)
  })

  it('is false where no starter runs: a redraft sport outside the list, an imported league, no league', () => {
    expect(scheduledDraftAutoStarts(true, { ...native, sport: 'CRICKET', leagueType: 'redraft', isDynasty: false })).toBe(false)
    // College basketball redraft starts on the server since 2026-11-25, Autostart on or off.
    expect(scheduledDraftAutoStarts(false, { ...native, sport: 'NCAAB', leagueType: 'redraft', isDynasty: false })).toBe(true)
    expect(scheduledDraftAutoStarts(true, { ...native, platform: 'sleeper', sport: 'NFL', leagueType: 'dynasty', isDynasty: true })).toBe(false)
    expect(scheduledDraftAutoStarts(true, null)).toBe(false)
  })
})

describe('top bar scheduled countdown', () => {
  const preDraft = {
    leagueName: 'Sunday League',
    sport: 'NFL',
    draftType: 'snake',
    teamCount: 12,
    rounds: 15,
    currentManagerOnClock: null,
    pickLabel: null,
    overallPickNumber: null,
    timerStatus: 'none' as const,
    timerRemainingSeconds: null,
    isCommissioner: false,
    draftStatus: 'pre_draft',
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders exactly the status label when no time is set', () => {
    render(<DraftTopBar {...preDraft} />)
    expect(screen.queryByTestId('draft-topbar-scheduled-countdown')).toBeNull()
    expect(screen.getByTestId('draft-topbar-center-slot').textContent).toContain('pre draft')
  })

  it('counts down to the scheduled time for a member, ticking every second', () => {
    render(<DraftTopBar {...preDraft} scheduledStartIso={iso(754)} />)
    const pill = screen.getByTestId('draft-topbar-scheduled-countdown')
    expect(pill.getAttribute('data-phase')).toBe('counting')
    expect(pill.getAttribute('aria-label')).toBe('Starts in 12:34')
    expect(screen.getByTestId('draft-topbar-scheduled-countdown-time').textContent).toBe('12:34')
    // It replaces the bare status label rather than sitting beside it.
    expect(screen.getByTestId('draft-topbar-center-slot').textContent).not.toContain('pre draft')
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByTestId('draft-topbar-scheduled-countdown-time').textContent).toBe('12:30')
  })

  it('uses hours for a long wait and days past 24 hours', () => {
    const { rerender } = render(<DraftTopBar {...preDraft} scheduledStartIso={iso(2 * 3600 + 5 * 60)} />)
    expect(screen.getByTestId('draft-topbar-scheduled-countdown-time').textContent).toBe('2h 05m')
    rerender(<DraftTopBar {...preDraft} scheduledStartIso={iso(3 * 86400 + 4 * 3600)} />)
    expect(screen.getByTestId('draft-topbar-scheduled-countdown-time').textContent).toBe('3d 4h')
  })

  it('keeps Start Draft for the commissioner and puts the countdown next to it', () => {
    render(<DraftTopBar {...preDraft} isCommissioner onStartDraft={() => {}} scheduledStartIso={iso(754)} />)
    const slot = screen.getByTestId('draft-topbar-center-slot')
    const start = screen.getByTestId('draft-topbar-start-draft')
    const pill = screen.getByTestId('draft-topbar-scheduled-countdown')
    expect(slot.contains(start)).toBe(true)
    expect(start.nextElementSibling).toBe(pill)
    expect(pill.textContent).toContain('12:34')
  })

  it('leaves the commissioner Start Draft button untouched when no time is set', () => {
    render(<DraftTopBar {...preDraft} isCommissioner onStartDraft={() => {}} />)
    expect(screen.queryByTestId('draft-topbar-scheduled-countdown')).toBeNull()
    expect(screen.getByTestId('draft-topbar-start-draft').className).not.toContain('max-sm:px-3.5')
  })

  it('says "Starting…" once the time passes when the server starts the draft, never a negative number', () => {
    render(<DraftTopBar {...preDraft} scheduledStartIso={iso(2)} scheduledStartAutoStarts />)
    expect(screen.getByTestId('draft-topbar-scheduled-countdown-time').textContent).toBe('0:02')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    const pill = screen.getByTestId('draft-topbar-scheduled-countdown')
    expect(pill.getAttribute('data-phase')).toBe('starting')
    expect(pill.textContent).toBe('Starting…')
    expect(pill.textContent).not.toMatch(/-\d/)
  })

  it('drops the countdown at the scheduled time when the commissioner has to start the draft', () => {
    render(<DraftTopBar {...preDraft} scheduledStartIso={iso(2)} />)
    expect(screen.getByTestId('draft-topbar-scheduled-countdown')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByTestId('draft-topbar-scheduled-countdown')).toBeNull()
    expect(screen.getByTestId('draft-topbar-center-slot').textContent).toContain('pre draft')
  })

  it('stops saying "Starting…" after the grace window', () => {
    render(<DraftTopBar {...preDraft} scheduledStartIso={iso(-(SCHEDULED_START_GRACE_MS / 1000) + 2)} scheduledStartAutoStarts />)
    expect(screen.getByTestId('draft-topbar-scheduled-countdown').getAttribute('data-phase')).toBe('starting')
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.queryByTestId('draft-topbar-scheduled-countdown')).toBeNull()
  })

  it('shows no countdown once the draft is live', () => {
    render(
      <DraftTopBar
        {...preDraft}
        draftStatus="in_progress"
        timerStatus="running"
        timerRemainingSeconds={54}
        scheduledStartIso={iso(-30)}
        scheduledStartAutoStarts
      />,
    )
    expect(screen.queryByTestId('draft-topbar-scheduled-countdown')).toBeNull()
    expect(screen.getByTestId('draft-topbar-clock')).toBeTruthy()
  })
})

describe('scheduled start copy', () => {
  const keys = [
    'draftRoom.topBar.scheduledStart.startsIn',
    'draftRoom.topBar.scheduledStart.starting',
    'draftRoom.topBar.scheduledStart.title',
  ]

  it('exists in English and Spanish, and never says "AI"', () => {
    for (const key of keys) {
      expect(translations.en[key], key).toBeTruthy()
      expect(translations.es[key], key).toBeTruthy()
      expect(translations.es[key]).not.toBe(translations.en[key])
      expect(`${translations.en[key]} ${translations.es[key]}`).not.toMatch(/\b(AI|IA)\b/)
    }
  })
})
