/**
 * S9 — `getSafeMessageMediaUrl` accepted anything starting with `/` as a same-site path, so
 * `//other-host/x.png` (protocol-relative: another host, fetched by every viewer's browser) passed,
 * and so did `/\other-host/x.png`, which a browser normalises to the same thing. The draft-room
 * sanitizer's `mediaUrl` let the backslash form through on the WRITE side too.
 *
 * Each rejected case is also resolved with the WHATWG URL parser here, to prove it really does leave
 * the origin — the test is about what a browser would fetch, not about string shapes.
 */
import { describe, expect, it } from 'vitest'

import { getSafeMessageMediaUrl, isSafeToRenderMedia } from '@/lib/rich-message/safeMedia'
import { sanitizeDraftChatRichMeta } from '@/lib/draft-room/draft-chat-contract'

const ORIGIN = 'https://allfantasy.ai'

const OFF_SITE = [
  '//evil.example/x.png',
  '/\\evil.example/x.png',
  '\\/evil.example/x.png',
  '/\t/evil.example/x.png',
  '/\n/evil.example/x.png',
  '  //evil.example/x.png',
]

describe('S9 getSafeMessageMediaUrl', () => {
  it.each(OFF_SITE)('rejects %j, which a browser would fetch from another host', (candidate) => {
    // Positive control: this candidate genuinely resolves off-site (or is unparseable as a path).
    let host: string | null = null
    try {
      host = new URL(candidate.trim(), ORIGIN).host
    } catch {
      host = null
    }
    if (host !== null) expect(host).not.toBe('allfantasy.ai')

    expect(getSafeMessageMediaUrl(candidate)).toBeNull()
    expect(isSafeToRenderMedia(candidate)).toBe(false)
  })

  it.each([
    '/uploads/chat/a.png',
    '/api/chat/upload/abc.gif',
    '/images/team logo.png',
  ])('keeps the same-site path %j', (path) => {
    expect(getSafeMessageMediaUrl(path)).toBe(path)
  })

  it.each([
    'https://media.giphy.com/media/abc/giphy.gif',
    'https://static.klipy.com/a.gif',
    'https://allfantasy.ai/uploads/a.png',
  ])('keeps the https media URL %j', (url) => {
    expect(getSafeMessageMediaUrl(url)).toBe(url)
  })

  it('still rejects script and data URLs', () => {
    expect(getSafeMessageMediaUrl('javascript:alert(1)')).toBeNull()
    expect(getSafeMessageMediaUrl('data:image/png;base64,AAAA')).toBeNull()
  })
})

describe('S9 draft-room attachment sanitizer (write side)', () => {
  it('drops a backslash-trick attachment URL and keeps a real upload path', () => {
    const out = sanitizeDraftChatRichMeta({
      attachments: [
        { type: 'image', url: '/\\evil.example/x.png' },
        { type: 'image', url: '/uploads/chat/ok.png' },
      ],
    })
    expect(out.attachments).toEqual([{ type: 'image', url: '/uploads/chat/ok.png' }])
  })
})
