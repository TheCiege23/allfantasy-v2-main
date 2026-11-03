import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FinalScoreLogos } from '@/components/notifications/FinalScoreLogos'

describe('final score crests', () => {
  const meta = { awayTeam: 'Away', homeTeam: 'Home', awayLogo: 'https://images.example/away.png', homeLogo: 'https://images.example/home.png' }

  it.each(['game_final', 'postgame_recap'])('shows both teams for %s', type => {
    const html = renderToStaticMarkup(<FinalScoreLogos type={type} meta={meta} />)
    expect(html).toContain('Away logo')
    expect(html).toContain('Home logo')
  })

  it('ignores invalid URLs and non-final alerts', () => {
    expect(renderToStaticMarkup(<FinalScoreLogos type="game_final" meta={{ ...meta, awayLogo: 'javascript:alert(1)' }} />)).not.toContain('javascript:')
    expect(renderToStaticMarkup(<FinalScoreLogos type="game_close" meta={meta} />)).toBe('')
  })
})
