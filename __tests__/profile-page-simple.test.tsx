import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /profile on a phone (2026-11-25, the simplify pass): one identity row, highlights and stats three
 * across, no empty store pitch, and quick links that do not repeat the Settings button or the back link.
 */
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }))
vi.mock('@/hooks/useSettingsProfile', () => ({
  useSettingsProfile: () => ({
    profile: { userId: 'u1', username: 'TheCiege26', displayName: 'Chris', bio: 'Hi', preferredSports: ['NFL'], avatarPreset: 'crown' },
    loading: false, saving: false, error: null, updateProfile: vi.fn(), fetchProfile: vi.fn(),
  }),
}))
vi.mock('@/hooks/useXPProfile', () => ({ useXPProfile: () => ({ profile: null, loading: false, error: null }) }))
vi.mock('@/hooks/useMarketplace', () => ({ useResolvedCosmetics: () => ({ cosmetics: [], loading: false, error: null }) }))
vi.mock('@/app/profile/EditableProfileFormController', () => ({ default: () => null }))

import ProfilePageClient from '@/app/profile/ProfilePageClient'

const STATS = {
  record: { wins: 42, losses: 30, ties: 1, byLeague: [{ leagueName: 'Dynasty Kings', wins: 12, losses: 5, ties: 0, rank: 2 }] },
  rankings: [{ leagueName: 'Dynasty Kings', season: '2026', grade: 'A-', rank: 2 }],
  achievements: [{ id: 'a', name: 'First title', description: '', icon: '🏆', earned: true }],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes('/api/profile/stats')
        ? STATS
        : String(url).includes('/api/profile/public')
          ? { username: 'GridironGuru', displayName: 'Sam Rivera', profileImageUrl: null, avatarPreset: 'crown', bio: 'Open to trades.', preferredSports: ['NFL'] }
          : {},
  })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function code(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('/profile, simplified', () => {
  it('keeps Settings on the identity row as a labelled button', () => {
    render(<ProfilePageClient isOwnProfile />)
    const settings = screen.getByTestId('profile-settings-link')
    expect(settings.getAttribute('aria-label')).toBe('Settings')
    expect(settings.getAttribute('href')).toBe('/settings')
  })

  it('shows highlights three across and no store pitch when nothing is equipped', async () => {
    render(<ProfilePageClient isOwnProfile />)
    expect((await screen.findByTestId('profile-highlights')).className).toMatch(/(^|\s)grid-cols-3(\s|$)/)
    expect(screen.queryByTestId('profile-cosmetics')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Visit the league Store tab/)
  })

  it('puts the stats three across with the latest grade, and quick links without repeats', async () => {
    render(<ProfilePageClient isOwnProfile />)
    await waitFor(() => expect(screen.getByTestId('profile-stats-grid')).toBeTruthy())
    expect(screen.getByTestId('profile-stats-grid').className).toMatch(/(^|\s)grid-cols-3(\s|$)/)
    expect(screen.getByTestId('profile-latest-grade').textContent).toBe('A-')
    const links = within(screen.getByTestId('profile-quick-links')).getAllByRole('link').map((a) => a.textContent?.trim())
    expect(links).toEqual(['Cross-league stats', 'Language, timezone, theme', 'View public profile'])
    expect(document.body.textContent).not.toMatch(/most recent league context/)
  })

  it('has no intro line under either profile heading', () => {
    expect(code('app/profile/page.tsx')).not.toMatch(/Your identity, preferences/)
    expect(code('app/profile/[username]/page.tsx')).not.toMatch(/Your identity and preferences|Public profile view/)
  })

  it("someone else's profile: Message once per width, no second card, no page heading", async () => {
    render(<ProfilePageClient isOwnProfile={false} publicUsername="GridironGuru" />)
    const phone = await screen.findByTestId('public-profile-message')
    expect(phone.className).toMatch(/(^|\s)sm:hidden(\s|$)/)
    expect(phone.className).toMatch(/(^|\s)w-full(\s|$)/)
    // The other Message link is the sm-and-up one beside the name: exactly two, never three.
    const messages = screen.getAllByRole('link', { name: /Message/ })
    expect(messages).toHaveLength(2)
    expect(messages.find((a) => a !== phone)!.parentElement!.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(document.body.textContent).not.toMatch(/Only shared info is shown/)
    expect(code('app/profile/[username]/page.tsx')).not.toMatch(/`@\$\{username\}`/)
  })
})

