// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { GlobalModeToggle } from '@/components/theme/GlobalModeToggle'

const route = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))
vi.mock('@/components/theme/ModeToggle', () => ({ ModeToggle: () => <button>Appearance</button> }))
afterEach(cleanup)

describe('draft navigation remains clear of the global theme control', () => {
  it.each(['/drafts/nba-room', '/draft/nba-room', '/draft-room/nba-room', '/mock-draft', '/mock-draft/'])('omits the floating control on %s', (pathname) => {
    route.pathname = pathname
    render(<GlobalModeToggle />)
    expect(screen.queryByRole('button', { name: 'Appearance' })).toBeNull()
  })
  it.each(['/pricing', '/', '/mock-draft-help', '/drafts-news'])('keeps the appearance control on %s', (pathname) => {
    route.pathname = pathname
    render(<GlobalModeToggle />)
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeDefined()
  })
})
