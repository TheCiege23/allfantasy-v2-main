/**
 * The planning cards for a long pick clock (2026-11-15). They key on the commissioner's clock length
 * and quiet hours — never on a "slow draft" mode, which does not exist.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PickClockPlanner, type PickClockPlannerProps } from '@/components/app/draft-room/PickClockPlanner'

const NOW = Date.parse('2026-11-15T20:20:00Z') // 3:20 PM ET
const ET = { start: '22:00', end: '08:00', timezone: 'America/New_York' }

function props(over: Partial<PickClockPlannerProps> = {}): PickClockPlannerProps {
  return {
    timerSeconds: 14_400,
    timerEndAtIso: new Date(NOW + 3 * 3600_000).toISOString(),
    isOnClock: false,
    picksAway: 5,
    nextLabel: '2.9',
    pickTimesMs: [],
    quietWindow: ET,
    allowPicksDuringPause: false,
    pausedForQuietHours: false,
    queueTop: { name: 'North Star', position: 'QB' },
    ...over,
  }
}

function mockProfile(draftAlerts: Record<string, unknown> | null, globalEnabled = true) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (init?.method === 'PATCH') return new Response('{}', { status: 200 })
    return new Response(
      JSON.stringify({ notificationPreferences: { globalEnabled, ...(draftAlerts ? { categories: { draft_alerts: draftAlerts } } : {}) } }),
      { status: 200 },
    )
  }))
  return calls
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PickClockPlanner', () => {
  it('shows nothing on a short clock with no quiet hours — a fast draft is unchanged', () => {
    const calls = mockProfile({ enabled: true, inApp: true, email: true, sms: false, push: true })
    const { container } = render(<PickClockPlanner {...props({ timerSeconds: 30, quietWindow: null })} />)
    expect(container).toBeEmptyDOMElement()
    expect(calls).toHaveLength(0)
  })

  it('on a long clock says when you are likely up, skipping quiet hours', async () => {
    mockProfile({ enabled: true, inApp: true, email: true, sms: false, push: true })
    render(<PickClockPlanner {...props()} />)
    const next = screen.getByTestId('pick-clock-next')
    expect(next).toHaveTextContent('Your next pick · 2.9')
    expect(within(next).getByTestId('pick-clock-next-headline')).toHaveTextContent(/Likely tomorrow, around/)
    expect(next).toHaveTextContent('5 picks to go, and the clock stops overnight.')
    expect(next).toHaveTextContent('Top of your queue: North Star, QB.')
  })

  it('explains quiet hours in the league’s time zone', () => {
    mockProfile(null)
    render(<PickClockPlanner {...props()} />)
    expect(screen.getByTestId('pick-clock-quiet-headline')).toHaveTextContent('Clock pauses at 10 PM ET')
    expect(screen.getByTestId('pick-clock-quiet')).toHaveTextContent('nobody can pick in between')
  })

  it('shows quiet hours alone on a short clock when the commissioner set them', () => {
    mockProfile(null)
    render(<PickClockPlanner {...props({ timerSeconds: 60 })} />)
    expect(screen.getByTestId('pick-clock-quiet')).toBeInTheDocument()
    expect(screen.queryByTestId('pick-clock-next')).toBeNull()
    expect(screen.queryByTestId('pick-clock-alerts')).toBeNull()
  })

  it('reads the real draft-alerts setting and its channels', async () => {
    mockProfile({ enabled: true, inApp: true, email: true, sms: false, push: true })
    render(<PickClockPlanner {...props()} />)
    await waitFor(() => expect(screen.getByTestId('pick-clock-alerts-headline')).toHaveTextContent('Draft alerts are on · push, email'))
  })

  it('turns draft alerts on by saving the whole entry, keeping its channels', async () => {
    const calls = mockProfile({ enabled: false, inApp: true, email: true, sms: true, push: false })
    render(<PickClockPlanner {...props()} />)
    await waitFor(() => expect(screen.getByTestId('pick-clock-alerts-headline')).toHaveTextContent('Draft alerts are off'))
    fireEvent.click(screen.getAllByTestId('pick-clock-alerts-turn-on')[0])
    await waitFor(() => expect(screen.getByTestId('pick-clock-alerts-headline')).toHaveTextContent(/^Draft alerts are on/))
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      notificationPreferences: { categories: { draft_alerts: { enabled: true, inApp: true, email: true, sms: true, push: false } } },
    })
  })

  it('says when every notification is off instead of offering a switch that would not help', async () => {
    mockProfile({ enabled: true, inApp: true, email: true, sms: false, push: true }, false)
    render(<PickClockPlanner {...props()} />)
    await waitFor(() => expect(screen.getByTestId('pick-clock-alerts-headline')).toHaveTextContent('All your notifications are off'))
    expect(screen.queryByTestId('pick-clock-alerts-turn-on')).toBeNull()
  })
})
