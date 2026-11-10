/**
 * The league name on the Tournament Home league card is readable on any conference colour (2026-11-09, tournament
 * gaps audit item 4). The banner is the conference colour with the name in white; on the first conference's gold
 * (#f5b800) that is 1.79:1. A dark scrim under the name keeps the colour and makes the name readable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LeagueIdentityCard } from '@/app/tournament/components/LeagueIdentityCard'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
afterEach(cleanup)

const gold = { id: 'c', name: 'Gridiron Conference', slug: 'gridiron', theme: 'gold', colorHex: '#f5b800', conferenceNumber: 1 } as any

/** Relative luminance and contrast, WCAG 2.x. */
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('League identity card banner', () => {
  it('puts a dark scrim under the league name', () => {
    render(<LeagueIdentityCard name="Gridiron North" conference={gold} roundLabel="Opening Round" teamSlots={8} currentCount={8} status="active" />)
    const name = screen.getByText('Gridiron North')
    const scrim = name.parentElement!.querySelector('[data-testid="league-identity-scrim"]') as HTMLElement
    expect(scrim, 'scrim beside the name').toBeTruthy()
    expect(scrim.className).toMatch(/\bbottom-0\b/)
    expect(name.className).toMatch(/\brelative\b/) // paints above the absolutely positioned scrim
    const alpha = Number(/from-black\/(\d+)/.exec(scrim.className)?.[1] ?? 0) / 100
    // White over gold darkened by the scrim's strongest stop must reach 4.5:1.
    const behind = [0xf5, 0xb8, 0x00].map((c) => c * (1 - alpha))
    expect(contrast([255, 255, 255], behind)).toBeGreaterThanOrEqual(4.5)
  })
})
