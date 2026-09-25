import { describe, expect, it } from 'vitest'
import {
  continuesRun,
  dayLabel,
  describeReactors,
  initialsFor,
  isDeletedMessage,
  isEditedMessage,
  layoutMessages,
  reactorIds,
  safeAvatarUrl,
  visibleBody,
} from '@/components/core-app/comms/chatLayout'

/*
 * The rules that decide what a League / DM / Huddle reader sees: whose side a
 * message is on, when a name repeats, where a day separator goes, and which body
 * text is just a stand-in for a GIF.
 */

const NOW = new Date('2026-09-25T15:00:00')
const at = (hhmm: string, day = '2026-09-25') => new Date(`${day}T${hhmm}:00`).toISOString()
const m = (id: string, authorId: string | null, createdAt: string) => ({ id, authorId, createdAt })

describe('layoutMessages — runs, sides and days', () => {
  it('puts the viewer on their own side', () => {
    const items = layoutMessages([m('a', 'me', at('14:00')), m('b', 'sam', at('14:01'))], 'me', NOW)
    const rows = items.filter((i) => i.kind === 'message')
    expect(rows.map((r) => (r.kind === 'message' ? r.mine : null))).toEqual([true, false])
  })

  it('groups consecutive messages from one sender inside five minutes into one run', () => {
    const items = layoutMessages(
      [m('a', 'sam', at('14:00')), m('b', 'sam', at('14:03')), m('c', 'sam', at('14:07'))],
      'me',
      NOW,
    ).filter((i) => i.kind === 'message')
    // a and b are one run (3 min apart); c is 4 min after b — still inside the window.
    expect(items.map((i) => (i.kind === 'message' ? [i.startsRun, i.endsRun] : null))).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ])
  })

  it('starts a new run past five minutes, and on a change of sender', () => {
    const items = layoutMessages(
      [m('a', 'sam', at('14:00')), m('b', 'sam', at('14:06')), m('c', 'jo', at('14:06'))],
      'me',
      NOW,
    ).filter((i) => i.kind === 'message')
    expect(items.map((i) => (i.kind === 'message' ? i.startsRun : null))).toEqual([true, true, true])
  })

  it('never joins two messages with no known sender — that is not evidence of one speaker', () => {
    expect(continuesRun(m('a', null, at('14:00')), m('b', null, at('14:00')))).toBe(false)
  })

  it('puts a day separator before the first message of each day, and a run never crosses it', () => {
    const items = layoutMessages(
      [m('a', 'sam', at('23:58', '2026-09-24')), m('b', 'sam', at('00:01'))],
      'me',
      NOW,
    )
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'day', 'message'])
    expect(items[0]).toMatchObject({ label: 'Yesterday' })
    expect(items[2]).toMatchObject({ label: 'Today' })
    expect(items[3]).toMatchObject({ startsRun: true })
  })
})

describe('dayLabel', () => {
  it('names today and yesterday, a weekday inside the week, and a real date beyond it', () => {
    expect(dayLabel(at('09:00'), NOW)).toBe('Today')
    expect(dayLabel(at('09:00', '2026-09-24'), NOW)).toBe('Yesterday')
    expect(dayLabel(at('09:00', '2026-09-21'), NOW)).toMatch(/Monday/)
    // Past a week a bare weekday names no particular day, so the date is there.
    expect(dayLabel(at('09:00', '2026-09-01'), NOW)).toMatch(/Sep|1/)
    expect(dayLabel(at('09:00', '2026-09-01'), NOW)).not.toBe('Tuesday')
  })

  it('says nothing for a date it cannot read', () => {
    expect(dayLabel('not a date', NOW)).toBe('')
  })
})

describe('avatars', () => {
  it('falls back to initials', () => {
    expect(initialsFor('Sam Darnold')).toBe('SD')
    expect(initialsFor('chimmy')).toBe('C')
    expect(initialsFor('   ')).toBe('?')
    expect(initialsFor('mary_jane_watson')).toBe('MW')
  })

  it('only puts https or same-origin URLs in an img', () => {
    expect(safeAvatarUrl('https://cdn.test/a.png')).toBe('https://cdn.test/a.png')
    expect(safeAvatarUrl('/avatars/a.png')).toBe('/avatars/a.png')
    expect(safeAvatarUrl('//evil.test/a.png')).toBeNull()
    expect(safeAvatarUrl('javascript:alert(1)')).toBeNull()
    expect(safeAvatarUrl('http://cdn.test/a.png')).toBeNull()
    expect(safeAvatarUrl('')).toBeNull()
    expect(safeAvatarUrl(null)).toBeNull()
  })
})

describe('visibleBody — the stand-in labels go once the real thing renders', () => {
  it('hides "🎬 GIF" when the GIF itself is shown', () => {
    expect(visibleBody({ body: '🎬 GIF', hasRich: true })).toBeNull()
  })

  it('KEEPS "🎬 GIF" when the GIF could not be shown — the reader should know something was sent', () => {
    expect(visibleBody({ body: '🎬 GIF', hasRich: false })).toBe('🎬 GIF')
  })

  it('hides a type-gif row’s URL body, but not a caption that merely contains a link', () => {
    expect(visibleBody({ body: 'https://static.klipy.com/a.gif', messageType: 'gif', hasRich: true })).toBeNull()
    expect(
      visibleBody({ body: 'look https://static.klipy.com/a.gif', messageType: 'gif', hasRich: true }),
    ).toBe('look https://static.klipy.com/a.gif')
  })

  it('hides the poll’s own question label and keeps a real caption', () => {
    const metadata = { poll: { question: 'Who wins?' } }
    expect(visibleBody({ body: '📊 Who wins?', metadata, hasRich: true })).toBeNull()
    expect(visibleBody({ body: 'vote now', metadata, hasRich: true })).toBe('vote now')
  })
})

describe('edited and deleted rows', () => {
  it('reads the server’s stamps', () => {
    expect(isDeletedMessage({ deletedAt: '2026-09-25T10:00:00Z' })).toBe(true)
    expect(isDeletedMessage({})).toBe(false)
    expect(isEditedMessage({ editedAt: '2026-09-25T10:00:00Z' })).toBe(true)
    expect(isEditedMessage(null)).toBe(false)
  })
})

describe('who reacted', () => {
  const meta = {
    reactions: [
      { emoji: '🔥', count: 3, userIds: ['me', 'u1', 'ghost'] },
      { emoji: '💀', count: 0, userIds: [] },
      { emoji: 42, userIds: ['x'] },
    ],
  }

  it('reads ids per emoji and drops empty or malformed entries', () => {
    expect(reactorIds(meta)).toEqual({ '🔥': ['me', 'u1', 'ghost'] })
    expect(reactorIds(null)).toEqual({})
  })

  it('names people it knows, puts you first, and counts the rest — never an id', () => {
    const names: Record<string, string> = { u1: 'Sam' }
    const out = describeReactors(['u1', 'me', 'ghost'], 'me', (id) => names[id] ?? null)
    expect(out.text).toBe('You, Sam and 1 other')
    expect(out.text).not.toContain('ghost')
  })
})
