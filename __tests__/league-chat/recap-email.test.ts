import { describe, expect, it } from 'vitest'
import { recapEmailSubject, renderRecapEmail } from '@/lib/league-chat/recapEmail'

/*
 * The Tuesday recap email: one per person per week, every recapped league of theirs, a button that
 * opens the league chat where "Share with your league" sits.
 */

const RECAP = [
  '📺 Week 5 recap — Death Squad (2026)',
  '',
  '🏆 Weekly awards',
  '  🚀 Boom of the week: MisterG201, 255.0',
  '',
  'Every number here comes from your real matchups. The full records book is in the Legacy tab.',
].join('\n')

const L = (leagueId: string, leagueName: string, text = RECAP) => ({ leagueId, leagueName, week: 5, season: '2026', text })

describe('renderRecapEmail', () => {
  it('carries the recap and a share button that opens the league chat', () => {
    const out = renderRecapEmail([L('L1', 'Death Squad')], 'https://allfantasy.ai')!
    expect(out.subject).toBe('Week 5 recap — Death Squad')
    expect(out.html).toContain('Boom of the week: MisterG201, 255.0')
    expect(out.html).toContain('href="https://allfantasy.ai/league/L1?openChat=league"')
    expect(out.html).toContain('Share it with your league')
    expect(out.html).toContain('Share with your league')
  })

  it('drops the in-app footer and the duplicate title line', () => {
    const out = renderRecapEmail([L('L1', 'Death Squad')], 'https://allfantasy.ai')!
    expect(out.html).not.toContain('Legacy tab')
    expect(out.html).not.toContain('📺 Week 5 recap')
  })

  it('escapes whatever a team name holds', () => {
    const out = renderRecapEmail(
      [L('L1', 'Death <Squad>', '📺 Week 5 recap\n  Boom: <img src=x onerror=alert(1)> & co, 99.0')],
      'https://allfantasy.ai',
    )!
    expect(out.html).not.toContain('<img src=x')
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co')
    expect(out.html).toContain('Death &lt;Squad&gt;')
  })

  it('one email for several leagues, each with its own share link', () => {
    const out = renderRecapEmail([L('L1', 'Death Squad'), L('L2', 'Iron Horse')], 'https://allfantasy.ai')!
    expect(out.subject).toBe('Week 5 recaps — Death Squad + 1 more')
    expect(out.html).toContain("Share Iron Horse's recap →")
    expect(out.html).toContain('href="https://allfantasy.ai/league/L2?openChat=league"')
    expect(out.html.match(/Boom of the week/g)).toHaveLength(2)
  })

  it('nothing for no recaps', () => {
    expect(renderRecapEmail([], 'https://allfantasy.ai')).toBeNull()
  })

  it('subject names the first league and how many more', () => {
    expect(recapEmailSubject([L('L1', 'A'), L('L2', 'B'), L('L3', 'C')])).toBe('Week 5 recaps — A + 2 more')
  })
})
