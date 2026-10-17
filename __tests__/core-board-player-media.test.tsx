import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlayerFace } from '@/components/core-app/boards/PlayerFace'

describe('Core board player media', () => {
  it('shows initials when a headshot fails and removes a failed club crest', () => {
    const { container } = render(<PlayerFace
      name="LeBron James"
      imageUrl="https://example.com/missing-player.png"
      teamLogoUrl="https://example.com/missing-logo.png"
    />)
    fireEvent.error(container.querySelector('img.af-bd-face')!)
    fireEvent.error(container.querySelector('img.af-bd-club')!)
    expect(container.querySelector('.af-bd-face--none')?.textContent).toBe('LJ')
    expect(container.querySelector('img.af-bd-club')).toBeNull()
  })
})
