// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  SpecialtyCountdown,
  SpecialtyHero,
  SpecialtyShell,
  formatSpecialtyCountdown,
  specialtyAsset,
  specialtyInitials,
  SPECIALTY_THEMES,
} from '@/components/league/specialty/SpecialtyShell'

describe('specialty shell helpers', () => {
  it('formats the hero countdown as the mockups do', () => {
    expect(formatSpecialtyCountdown((1 * 86400 + 6 * 3600 + 40 * 60) * 1000)).toBe('1d 06:40')
    expect(formatSpecialtyCountdown((6 * 3600 + 40 * 60 + 12) * 1000)).toBe('06:40:12')
    expect(formatSpecialtyCountdown(0)).toBeNull()
    expect(formatSpecialtyCountdown(-5)).toBeNull()
    expect(formatSpecialtyCountdown(null)).toBeNull()
  })

  it('derives avatar initials like the mockups', () => {
    expect(specialtyInitials('Open Team 12')).toBe('O12')
    expect(specialtyInitials('TheCiege26')).toBe('TC')
    expect(specialtyInitials('Blah House')).toBe('BH')
    expect(specialtyInitials('')).toBe('?')
  })

  it('carries the README theme table', () => {
    expect(SPECIALTY_THEMES.guillotine).toMatchObject({ acc: '#e0402e', disp: 'Bebas Neue' })
    expect(SPECIALTY_THEMES.bigbrother).toMatchObject({ acc: '#3b82f6', disp: 'Archivo' })
    expect(specialtyAsset('guillotine', 'emblem.svg')).toBe('/specialty/guillotine/emblem.svg')
  })
})

describe('specialty shell components', () => {
  it('sets the theme tokens on the root and renders the hero', () => {
    const { container } = render(
      <SpecialtyShell format="guillotine" testId="shell">
        <SpecialtyHero
          format="guillotine"
          bannerSrc="/b.svg"
          emblemSrc="/e.svg"
          emblemAlt="Guilly crest"
          chips={['NFL', '2026']}
          title="Guilly League 26"
          headline="Week 5"
          actions={[{ label: 'Set lineup', href: '/x', primary: true }, { label: 'Disabled' }]}
        />
      </SpecialtyShell>,
    )
    const root = screen.getByTestId('shell')
    expect(root.style.getPropertyValue('--acc')).toBe('#e0402e')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Guilly League 26')
    expect(screen.getByRole('link', { name: 'Set lineup' }).getAttribute('href')).toBe('/x')
    // An action with neither href nor onClick is a disabled button, never a dead link.
    expect((screen.getByRole('button', { name: 'Disabled' }) as HTMLButtonElement).disabled).toBe(true)
    expect(container.querySelector('img[alt="Guilly crest"]')).not.toBeNull()
  })

  it('countdown shows the fallback for a missing or past target', () => {
    render(<SpecialtyCountdown label="Chop locks in" target={new Date(Date.now() - 1000)} fallback="Locked" />)
    expect(screen.getByTestId('specialty-countdown').textContent).toContain('Locked')
  })
})
