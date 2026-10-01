import { describe, expect, it } from 'vitest'

import { chimmyReplyAsPlainText, chimmyReplyAsSocialPost, SOCIAL_POST_LIMIT } from '@/lib/chimmy-chat/copyText'

const REPLY = `## The short version

**Slightly favors JeffersonTD.** You give Braelon Allen (1,501) for a 2028 2nd (1,186).

- *Allen* is a real dynasty asset
- The pick is two drafts away

---

Want me to find a counter?`

describe('Chimmy copy text', () => {
  it('plain text: no markdown left, bullets kept as •', () => {
    expect(chimmyReplyAsPlainText(REPLY)).toBe(
      'The short version\n\nSlightly favors JeffersonTD. You give Braelon Allen (1,501) for a 2028 2nd (1,186).\n\n' +
        '• Allen is a real dynasty asset\n• The pick is two drafts away\n\nWant me to find a counter?',
    )
  })

  it('social post: first real paragraph, whole sentences, signed, within the limit', () => {
    const post = chimmyReplyAsSocialPost('**Slightly favors JeffersonTD.** You give Braelon Allen for a 2028 2nd.\n\nMore detail here.')
    expect(post).toBe('Slightly favors JeffersonTD. You give Braelon Allen for a 2028 2nd. — Chimmy on AllFantasy.ai')
    const long = chimmyReplyAsSocialPost(`${'One short sentence. '.repeat(30)}`)
    expect(long.length).toBeLessThanOrEqual(SOCIAL_POST_LIMIT)
    expect(long).toMatch(/sentence\. — Chimmy on AllFantasy\.ai$/)
    // A single sentence longer than a post is cut at a word, marked with an ellipsis.
    const oneLong = chimmyReplyAsSocialPost('word '.repeat(100))
    expect(oneLong.length).toBeLessThanOrEqual(SOCIAL_POST_LIMIT)
    expect(oneLong).toMatch(/word… — Chimmy on AllFantasy\.ai$/)
  })
})
