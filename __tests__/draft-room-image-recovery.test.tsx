// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LazyDraftImage } from '@/components/app/draft-room/LazyDraftImage'

afterEach(cleanup)
describe('draft image CDN recovery', () => {
  it('tries the same vendor image on the alternate host before reporting failure', () => {
    const onError = vi.fn()
    const props = { src: 'https://r2.thesportsdb.com/images/media/player/cutout/new-photo.png', alt: 'Player', width: 40, height: 40, lazy: false, onError }
    const view = render(<LazyDraftImage {...props} />)
    fireEvent.error(screen.getByAltText('Player'))
    expect(screen.getByAltText('Player').getAttribute('src')).toBe('https://www.thesportsdb.com/images/media/player/cutout/new-photo.png')
    expect(onError).not.toHaveBeenCalled()
    fireEvent.error(screen.getByAltText('Player'))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(screen.queryByAltText('Player')).toBeNull()
    view.rerender(<LazyDraftImage {...props} src="https://sleepercdn.com/new.jpg" />)
    expect(screen.getByAltText('Player').getAttribute('src')).toBe('https://sleepercdn.com/new.jpg')
  })
  it('reports a non-vendor error immediately without a host retry', () => {
    const onError = vi.fn()
    render(<LazyDraftImage src="https://sleepercdn.com/missing.jpg" alt="Other" width={40} height={40} lazy={false} onError={onError} />)
    fireEvent.error(screen.getByAltText('Other'))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(screen.queryByAltText('Other')).toBeNull()
  })
})
