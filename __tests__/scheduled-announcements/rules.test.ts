import { describe, expect, it } from 'vitest'
import {
  HISTORY_KEEP,
  MAX_PENDING_PER_LEAGUE,
  SCHEDULED_ANNOUNCEMENTS_KEY,
  dueAnnouncements,
  parseScheduleInput,
  readScheduledAnnouncements,
  staleClaims,
  updateAnnouncement,
  withScheduledAnnouncements,
  type ScheduledAnnouncement,
} from '@/lib/commissioner/scheduledAnnouncements'

const NOW = new Date('2026-10-20T12:00:00Z')
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()
const a = (id: string, sendAt: string, status: ScheduledAnnouncement['status'] = 'pending', extra: Partial<ScheduledAnnouncement> = {}): ScheduledAnnouncement => ({
  id, message: `m-${id}`, sendAt, byUserId: 'u', createdAt: NOW.toISOString(), status, ...extra,
})

describe('scheduled announcements (pure)', () => {
  it('reads valid entries earliest first and drops junk', () => {
    const settings = { [SCHEDULED_ANNOUNCEMENTS_KEY]: [a('b', at(60)), { id: 'x' }, a('a', at(30)), a('bad', 'not-a-date'), 7] }
    expect(readScheduledAnnouncements(settings).map((x) => x.id)).toEqual(['a', 'b'])
    expect(readScheduledAnnouncements(null)).toEqual([])
  })

  it('accepts a message and a time 15 min – 90 days out, normalised to ISO', () => {
    const r = parseScheduleInput({ message: '  Trade deadline Sunday  ', sendAt: '2026-10-21T18:30:00-04:00' }, [], NOW)
    expect(r).toEqual({ ok: true, value: { message: 'Trade deadline Sunday', sendAt: '2026-10-21T22:30:00.000Z' } })
  })

  it.each([
    [{ message: '', sendAt: at(60) }, 'bad_message'],
    [{ message: 'x'.repeat(501), sendAt: at(60) }, 'bad_message'],
    [{ message: 'hi', sendAt: 'tomorrow' }, 'bad_time'],
    [{ message: 'hi' }, 'bad_time'],
    [{ message: 'hi', sendAt: at(14) }, 'too_soon'],
    [{ message: 'hi', sendAt: at(-5) }, 'too_soon'],
    [{ message: 'hi', sendAt: at(91 * 24 * 60) }, 'too_far'],
  ])('%j → %s', (body, error) => {
    expect(parseScheduleInput(body, [], NOW)).toEqual({ ok: false, error })
  })

  it('caps pending posts per league; finished ones do not count', () => {
    const full = Array.from({ length: MAX_PENDING_PER_LEAGUE }, (_, i) => a(`p${i}`, at(100 + i)))
    expect(parseScheduleInput({ message: 'hi', sendAt: at(60) }, full, NOW)).toEqual({ ok: false, error: 'too_many' })
    const withDone = [...full.slice(1), a('s', at(-60), 'sent')]
    expect(parseScheduleInput({ message: 'hi', sendAt: at(60) }, withDone, NOW).ok).toBe(true)
  })

  it('due = pending at or before now; a claim older than 30 min is stale', () => {
    const list = [a('due', at(0)), a('past', at(-90)), a('later', at(1)), a('sent', at(-5), 'sent'),
      a('fresh', at(-10), 'sending', { claimedAt: at(-10) }), a('old', at(-60), 'sending', { claimedAt: at(-31) })]
    expect(dueAnnouncements(list, NOW).map((x) => x.id)).toEqual(['due', 'past'])
    expect(staleClaims(list, NOW).map((x) => x.id)).toEqual(['old'])
  })

  it('writing keeps every open post, the newest finished ones, other settings — and removes an empty key', () => {
    const done = Array.from({ length: HISTORY_KEEP + 5 }, (_, i) => a(`d${i}`, at(-1000 + i), 'sent', { finishedAt: at(-1000 + i) }))
    const out = withScheduledAnnouncements({ keep: 1 }, [a('open', at(60)), ...done])
    const kept = out[SCHEDULED_ANNOUNCEMENTS_KEY] as ScheduledAnnouncement[]
    expect(out.keep).toBe(1)
    expect(kept).toHaveLength(HISTORY_KEEP + 1)
    expect(kept.some((x) => x.id === 'open')).toBe(true)
    expect(kept.some((x) => x.id === 'd0')).toBe(false) // oldest history dropped
    expect(SCHEDULED_ANNOUNCEMENTS_KEY in withScheduledAnnouncements({ [SCHEDULED_ANNOUNCEMENTS_KEY]: [a('x', at(1))] }, [])).toBe(false)
  })

  it('updateAnnouncement replaces one entry only', () => {
    const list = [a('a', at(1)), a('b', at(2))]
    const next = updateAnnouncement(list, 'b', { status: 'cancelled' })
    expect(next.map((x) => x.status)).toEqual(['pending', 'cancelled'])
    expect(list[1].status).toBe('pending')
  })
})
