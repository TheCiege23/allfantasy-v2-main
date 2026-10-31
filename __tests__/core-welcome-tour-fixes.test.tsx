import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { CoreWelcomeTour } from '@/components/core-app/CoreWelcomeTour'

/** Walks to the last step and returns its primary link, if any. */
function lastStepLink(): HTMLAnchorElement | null {
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  return screen.queryByRole('link') as HTMLAnchorElement | null
}

describe('CoreWelcomeTour', () => {
  beforeEach(() => window.localStorage.clear())

  it('ends on the lineup check for a manager with leagues, never the commissioner hubs', () => {
    render(<CoreWelcomeTour leagueCount={3} />)
    const link = lastStepLink()
    expect(link?.getAttribute('href')).toBe('/core/my-team')
    expect(link?.textContent).toBe('Check my lineups')
    expect(document.body.innerHTML).not.toContain('/core/hubs')
  })

  it('ends on the import for a manager with no leagues', () => {
    render(<CoreWelcomeTour leagueCount={0} />)
    expect(lastStepLink()?.getAttribute('href')).toBe('/import')
  })

  it('names a control that exists, and finishes without internal jargon', () => {
    render(<CoreWelcomeTour leagueCount={2} />)
    expect(screen.getByText(/league switcher at the top/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Open Leagues')
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('button', { name: 'Get started' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('Start using Core')
  })

  it('exposes progress as a progressbar, and is a region rather than a non-modal dialog', () => {
    render(<CoreWelcomeTour leagueCount={1} />)
    const bar = screen.getByRole('progressbar', { name: 'Step 1 of 4' })
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('region', { name: '1 league ready' })).toBeTruthy()
  })

  it('is mounted on the home screen only', () => {
    const shell = readFileSync(resolve(__dirname, '../components/core-app/AfCoreShell.tsx'), 'utf8')
    expect(shell).toContain("{active === 'home' ? <CoreWelcomeTour leagueCount={leagues.length} /> : null}")
  })
})
