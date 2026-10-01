import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { FallbackImg } from '@/components/core-app/FallbackImg'
import { PlayerHeadshot } from '@/components/league/PlayerHeadshot'
import { getPrimaryLogoUrlForTeam } from '@/lib/sport-teams/SportTeamMetadataRegistry'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'

/*
 * A URL on file is not an image that loads: Sleeper refuses ~10% of current NFL ids, and a guessed
 * logo path 404s. Every surface here handled the missing URL and drew a broken-image glyph for the
 * dead one.
 */

afterEach(cleanup)

describe('FallbackImg', () => {
  it('draws the image, and the fallback once the image fails', () => {
    const { container } = render(
      <FallbackImg src="https://cdn.example/dead.jpg" alt="" loading="lazy" fallback={<span className="fb">AB</span>} />,
    )
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://cdn.example/dead.jpg')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.fb')?.textContent).toBe('AB')
  })

  it('tries a new URL again after an old one failed', () => {
    const { container, rerender } = render(
      <FallbackImg src="https://cdn.example/a.jpg" alt="" loading="lazy" fallback={<span className="fb" />} />,
    )
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    rerender(<FallbackImg src="https://cdn.example/b.jpg" alt="" loading="lazy" fallback={<span className="fb" />} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/b.jpg')
  })
})

describe('the legacy PlayerHeadshot', () => {
  it('falls back to the same shield for a dead URL as for a missing one', () => {
    const { container } = render(<PlayerHeadshot src="https://sleepercdn.com/content/nfl/players/thumb/1.jpg" alt="Some Player" size={32} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Some Player')
  })
})

describe('a team logo is never guessed for something that is not a team', () => {
  it('returns nothing for a free agent, in any spelling the providers use', () => {
    for (const fa of ['FA', 'fa', ' FA ', 'F/A', 'Free Agent', 'N/A', '—', '']) {
      expect(getPrimaryLogoUrlForTeam('NFL', fa)).toBeNull()
    }
  })

  it('still resolves a real club, and still attempts a club the static lists miss', () => {
    expect(getPrimaryLogoUrlForTeam('NFL', 'KC')).toMatch(/\/nfl\/500\/kc\.png$/)
    /* Deliberate, per the registry's own note: an unlisted soccer club is still attempted. */
    expect(getPrimaryLogoUrlForTeam('SOCCER', 'XYZFC')).toMatch(/\/soccer\/500\/xyzfc\.png$/)
  })

  it('gives the trade screens nothing for a free agent, through the safe helper', () => {
    expect(teamLogoUrl('NFL', 'FA')).toBeNull()
    expect(teamLogoUrl('NFL', 'KC')).toMatch(/kc\.png$/)
  })
})
