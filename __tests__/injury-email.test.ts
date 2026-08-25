import { describe, expect, it } from 'vitest'

import { renderInjuryEmail } from '@/lib/notifications/injuryEmail'

/**
 * The injury email did not exist. An injured starter is the most time-critical
 * thing this product knows, and it was the one event with no email template at
 * all — while digests and trade alerts had designed ones.
 */

const BASE = 'https://allfantasy.ai'

describe('renderInjuryEmail', () => {
  it('lists every flagged starter, not just the most urgent one', () => {
    // The push picks a single alert because a phone banner has room for one
    // sentence. An email does not, and the two a manager does not see are
    // exactly the two he misses.
    const out = renderInjuryEmail({
      alerts: [
        { title: 'Ashton Jeanty is Out', message: 'Ruled out — ankle.' },
        { title: 'Puka Nacua is Doubtful', message: 'Limited Friday.' },
        { title: 'Sam LaPorta is Questionable', message: 'Knee.' },
      ],
      baseUrl: BASE,
    })
    expect(out).not.toBeNull()
    expect(out!.html).toContain('Ashton Jeanty')
    expect(out!.html).toContain('Puka Nacua')
    expect(out!.html).toContain('Sam LaPorta')
    expect(out!.subject).toBe('3 starters need a look before kickoff')
  })

  it('uses the alert as the subject when there is only one', () => {
    const out = renderInjuryEmail({
      alerts: [{ title: 'Ashton Jeanty is Out', message: 'Ruled out — ankle.' }],
      baseUrl: BASE,
    })
    expect(out!.subject).toBe('Ashton Jeanty is Out')
  })

  it('renders real HTML rather than one flattened paragraph', () => {
    // The dispatcher's default sender strips every tag; this template only
    // works through emailOverride, so it must actually carry markup.
    const out = renderInjuryEmail({
      alerts: [{ title: 'A', message: 'B' }],
      baseUrl: BASE,
    })
    expect(out!.html).toMatch(/<html/i)
    expect(out!.html).toMatch(/<strong/i)
  })

  it('escapes a player name that contains markup', () => {
    const out = renderInjuryEmail({
      alerts: [{ title: '<script>alert(1)</script>', message: 'x' }],
      baseUrl: BASE,
    })
    expect(out!.html).not.toContain('<script>')
    expect(out!.html).toContain('&lt;script&gt;')
  })

  it('names where the claim comes from instead of sounding like an opinion', () => {
    const out = renderInjuryEmail({ alerts: [{ title: 'A', message: 'B' }], baseUrl: BASE })
    expect(out!.html).toContain('From the injury feed')
  })

  it('invents no timeline — no database here holds an expected return', () => {
    const out = renderInjuryEmail({
      alerts: [{ title: 'Ashton Jeanty is Out', message: 'Ruled out — ankle.' }],
      baseUrl: BASE,
    })
    expect(out!.html).not.toMatch(/expected back|weeks out|return(s|ing)? (in|on)/i)
  })

  it('carries a preferences link so the email has a way out', () => {
    const out = renderInjuryEmail({ alerts: [{ title: 'A', message: 'B' }], baseUrl: BASE })
    expect(out!.html).toContain('/settings?tab=notifications')
  })

  it('renders nothing at all when there is nothing to say', () => {
    expect(renderInjuryEmail({ alerts: [], baseUrl: BASE })).toBeNull()
    expect(renderInjuryEmail({ alerts: [{ title: '  ', message: 'x' }], baseUrl: BASE })).toBeNull()
  })
})
