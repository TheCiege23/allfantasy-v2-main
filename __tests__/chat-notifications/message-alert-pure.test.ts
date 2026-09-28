// @vitest-environment node
/**
 * The pure halves of "you got a message": the preview line, the throttle decision, the email.
 *
 * These are the rules the owner asked for (2026-09-25), stated as tests:
 *  - a preview is plain text, ~140 chars, and a GIF / photo / poll says so instead of leaking a URL
 *  - at most one alert per conversation per 10 minutes WHILE UNREAD; reading resets it
 *  - no alert for a message already read, or for someone reading the conversation right now
 *  - email at most once per conversation an hour
 *  - every user-typed string in the email is escaped
 */
import { describe, expect, it } from 'vitest'

import { buildMessagePreview, MESSAGE_PREVIEW_MAX_CHARS } from '@/lib/chat-notifications/messagePreview'
import {
  ACTIVE_VIEWER_WINDOW_MS,
  DM_ALERT_WINDOW_MS,
  DM_EMAIL_WINDOW_MS,
  decideChatAlert,
  nextChatAlertState,
  readChatAlertState,
} from '@/lib/chat-notifications/alertThrottle'
import { buildDirectMessageEmail, buildDirectMessageEmailSubject } from '@/lib/chat-notifications/directMessageEmail'
import { isContactShaped, safeDisplayName } from '@/lib/chat-notifications/displayName'

describe('buildMessagePreview', () => {
  it('plain text passes through, whitespace collapsed', () => {
    expect(buildMessagePreview({ messageType: 'text', body: '  want   to\n talk Kelce?  ' })).toBe('want to talk Kelce?')
  })

  it(`cuts at ${MESSAGE_PREVIEW_MAX_CHARS} characters with an ellipsis`, () => {
    const out = buildMessagePreview({ body: 'x'.repeat(500) })
    expect(Array.from(out)).toHaveLength(MESSAGE_PREVIEW_MAX_CHARS)
    expect(out.endsWith('…')).toBe(true)
  })

  it('never splits an emoji when it cuts', () => {
    const out = buildMessagePreview({ body: '🏈'.repeat(300) })
    // Every code point is a whole football or the ellipsis — no lone surrogate.
    expect(Array.from(out).every((c) => c === '🏈' || c === '…')).toBe(true)
  })

  it.each([
    ['image', 'https://cdn.example/x.png', 'sent a photo'],
    ['gif', 'https://media.giphy.com/abc.gif', 'sent a GIF'],
    ['video', 'https://cdn.example/v.mp4', 'sent a video'],
    ['file', 'https://cdn.example/f.pdf', 'sent a file'],
  ])('a %s message never previews its URL body', (messageType, body, expected) => {
    expect(buildMessagePreview({ messageType, body })).toBe(expected)
  })

  it('a poll previews its question, not its JSON body', () => {
    const body = JSON.stringify({ question: 'Who starts at flex?', options: ['A', 'B'], votes: {} })
    expect(buildMessagePreview({ messageType: 'poll', body })).toBe('sent a poll: Who starts at flex?')
  })

  it('a composer GIF placeholder ("🎬 GIF") reads as a GIF', () => {
    expect(buildMessagePreview({ body: '🎬 GIF', metadata: { gif: { url: 'https://giphy/x.gif' } } })).toBe('sent a GIF')
  })

  it('a photo attachment with no words reads as a photo', () => {
    expect(buildMessagePreview({ body: '📎 Media', metadata: { attachments: [{ type: 'image', url: 'https://x/y.png' }] } })).toBe('sent a photo')
  })

  it('words beat the attachment when there are words', () => {
    expect(buildMessagePreview({ body: 'look at this', metadata: { attachments: [{ type: 'image', url: 'https://x/y.png' }] } })).toBe('look at this')
  })

  it('swearing is censored the way the conversation renders it', () => {
    const out = buildMessagePreview({ body: 'what the fuck was that trade' })
    expect(out).not.toMatch(/fuck/i)
    expect(out.startsWith('what the f')).toBe(true)
  })
})

describe('decideChatAlert', () => {
  const now = new Date('2026-09-25T18:00:00Z')
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)

  it('first message in a conversation: alert, with email', () => {
    expect(decideChatAlert({ now, messageAt: now, lastReadAt: minutesAgo(60), state: null })).toEqual({ alert: true, email: true })
  })

  it('🛑 a second message inside 10 minutes, still unread, is throttled', () => {
    const state = nextChatAlertState(null, minutesAgo(3), true)
    expect(decideChatAlert({ now, messageAt: now, lastReadAt: minutesAgo(60), state })).toEqual({ alert: false, reason: 'throttled' })
  })

  it('after the 10-minute window the next unread message alerts again', () => {
    const state = nextChatAlertState(null, new Date(now.getTime() - DM_ALERT_WINDOW_MS - 1000), true)
    expect(decideChatAlert({ now, messageAt: now, lastReadAt: minutesAgo(60), state })).toMatchObject({ alert: true })
  })

  it('🛑 reading since the last alert resets the throttle — the reply is news again', () => {
    const state = nextChatAlertState(null, minutesAgo(5), true)
    const decision = decideChatAlert({ now, messageAt: now, lastReadAt: minutesAgo(2), state })
    expect(decision).toMatchObject({ alert: true })
  })

  it('email rides along at most once an hour per conversation', () => {
    const state = nextChatAlertState(null, minutesAgo(30), true)
    expect(decideChatAlert({ now, messageAt: now, lastReadAt: minutesAgo(20), state })).toEqual({ alert: true, email: false })
    const older = nextChatAlertState(null, new Date(now.getTime() - DM_EMAIL_WINDOW_MS - 1000), true)
    expect(decideChatAlert({ now, messageAt: now, lastReadAt: minutesAgo(20), state: older })).toEqual({ alert: true, email: true })
  })

  it('already read past this message: no alert', () => {
    expect(decideChatAlert({ now, messageAt: minutesAgo(1), lastReadAt: now, state: null })).toEqual({ alert: false, reason: 'already_read' })
  })

  it('reading the conversation right now (fresh read stamp): no alert', () => {
    const lastReadAt = new Date(now.getTime() - ACTIVE_VIEWER_WINDOW_MS / 2)
    expect(decideChatAlert({ now, messageAt: now, lastReadAt, state: null })).toEqual({ alert: false, reason: 'viewing' })
  })

  it('league chat (no read tracking) is a plain 10-minute window', () => {
    const state = nextChatAlertState(null, minutesAgo(5), false)
    expect(decideChatAlert({ now, messageAt: now, lastReadAt: now, state, trackReads: false })).toEqual({ alert: false, reason: 'throttled' })
    expect(decideChatAlert({ now, messageAt: now, lastReadAt: now, state: null, trackReads: false })).toMatchObject({ alert: true })
  })

  it('a stored state that is not the expected shape reads as none', () => {
    expect(readChatAlertState({ something: 'else' })).toBeNull()
    expect(readChatAlertState(null)).toBeNull()
    expect(readChatAlertState([1, 2])).toBeNull()
  })
})

describe('buildDirectMessageEmail', () => {
  const base = {
    preview: 'hey',
    isGroup: false,
    conversationUrl: 'https://af.test/messages?thread=t1&message=m1',
    baseUrl: 'https://af.test',
    unsubscribeUrl: 'https://af.test/api/email/unsubscribe?token=tok',
  }

  it('🛑 escapes the sender, the preview and the huddle title', () => {
    const { html } = buildDirectMessageEmail({
      ...base,
      senderName: '<img src=x onerror=alert(1)>',
      preview: '<script>steal()</script> & more',
      threadTitle: '"><b>x</b>',
      isGroup: true,
    })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt; &amp; more')
  })

  it('carries the preview, a button to the conversation, and the unsubscribe link', () => {
    const { subject, html } = buildDirectMessageEmail({ ...base, senderName: 'Dana' })
    expect(subject).toBe('Dana sent you a message')
    expect(html).toContain('Open conversation')
    expect(html).toContain('href="https://af.test/messages?thread=t1&amp;message=m1"')
    expect(html).toContain('Unsubscribe')
    expect(html).toContain('/settings?tab=notifications')
  })

  it('a newline in a display name never reaches the subject header', () => {
    const subject = buildDirectMessageEmailSubject({ senderName: 'Dana\r\nBcc: x@y.z', isGroup: false })
    expect(subject).not.toMatch(/[\r\n]/)
  })

  it('a huddle subject names the huddle', () => {
    expect(buildDirectMessageEmailSubject({ senderName: 'Dana', threadTitle: 'Sunday Crew', isGroup: true })).toBe('Dana posted in Sunday Crew')
  })
})

describe('safeDisplayName — never an address or a number', () => {
  it('skips an email-shaped or phone-shaped name and takes the next', () => {
    expect(safeDisplayName(['dana@example.org', 'dana_ffl'])).toBe('dana_ffl')
    expect(safeDisplayName(['+1 (361) 555-0100', null, 'Dana'])).toBe('Dana')
    expect(safeDisplayName(['a@b.co'], 'Someone')).toBe('Someone')
  })

  it('does not reject a real name with digits in it', () => {
    expect(isContactShaped('Team 12')).toBe(false)
    expect(isContactShaped('2026 Champs')).toBe(false)
  })
})
