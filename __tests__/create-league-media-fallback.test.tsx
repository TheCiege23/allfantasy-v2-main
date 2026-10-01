import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Segmented } from '@/components/create-league-v2/primitives'
import { ACCENTS } from '@/lib/create-league-v2/theme'
import { CreateLeagueHeroMedia } from '@/components/create-league-v2/CreateLeagueHeroMedia'

describe('Create League thumbnail fallbacks', () => {
  it('tries a video fallback once when the hero clip fails', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    try {
      const { container } = render(<CreateLeagueHeroMedia
        media={{ video: '/media/create-league/drafts/videos/Snake Draft.mp4', fallback: '/media/create-league/sports/videos/Football.mp4', poster: '/media/create-league/drafts/thumbnails/Snake Draft.png', mediaKey: 'draft:snake' }}
        accent={ACCENTS.redraft}
      />)
      const video = container.querySelector('video')!
      fireEvent.error(video)
      expect(video.src).toContain('/media/create-league/sports/videos/Football.mp4')
      expect(load).toHaveBeenCalledTimes(1)
      fireEvent.error(video)
      expect(load).toHaveBeenCalledTimes(1)
    } finally {
      load.mockRestore()
    }
  })
  it('Segmented draft row tolerates empty thumbnailSrc with gradient strip', () => {
    render(
      <Segmented
        options={[{ value: 'snake', label: 'Snake', hint: 'Test', thumbnailSrc: '' }]}
        value="snake"
        onChange={() => {}}
        accent={ACCENTS.redraft}
        ariaLabel="Draft format"
      />,
    )
    expect(screen.getByRole('radio', { name: /Snake/i })).toBeInTheDocument()
  })
})
