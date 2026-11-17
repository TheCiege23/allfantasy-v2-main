/**
 * The settings window's privacy and invite options reach what joins and Find League read (2026-11-15).
 *
 * 🛑 "Listing & discoverability" saved a key nothing read, and "Disable league invite links" saved a column the invite
 * check ignored. The General tab now shows the league's real privacy editor, and that editor and the invite check
 * agree on the column.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const db = vi.hoisted(() => ({ league: { findUnique: vi.fn(), update: vi.fn(async () => ({})) } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/components/app/settings/LeaguePrivacyAndInvitesPanel', () => ({
  default: ({ leagueId }: { leagueId: string }) => <div data-testid="real-privacy-editor">{leagueId}</div>,
}))

import { getLeaguePrivacySettings, updateLeaguePrivacySettings } from '@/lib/league-privacy/LeaguePrivacyResolver'

beforeEach(() => vi.clearAllMocks())

describe('the privacy editor and the invite column agree', () => {
  it('shows the link off when the column turned it off', async () => {
    db.league.findUnique.mockResolvedValue({ settings: { league_allow_invite_link: true }, disableInviteLinks: true })
    expect((await getLeaguePrivacySettings('L1')).allowInviteLink).toBe(false)
  })

  it('turning the link on or off here writes the column too', async () => {
    db.league.findUnique.mockResolvedValue({ settings: {}, disableInviteLinks: true })
    const out = await updateLeaguePrivacySettings('L1', { allowInviteLink: true })
    expect(db.league.update.mock.calls[0]![0].data).toMatchObject({ disableInviteLinks: false })
    expect(out.allowInviteLink).toBe(true)
    await updateLeaguePrivacySettings('L1', { allowInviteLink: false })
    expect(db.league.update.mock.calls[1]![0].data).toMatchObject({ disableInviteLinks: true })
  })

  it('a save that does not touch the link leaves the column alone', async () => {
    db.league.findUnique.mockResolvedValue({ settings: {}, disableInviteLinks: true })
    const out = await updateLeaguePrivacySettings('L1', { visibility: 'public' })
    expect(db.league.update.mock.calls[0]![0].data).not.toHaveProperty('disableInviteLinks')
    expect(out.allowInviteLink).toBe(false)
  })
})

describe('the General tab', () => {
  it('shows the real privacy editor instead of the listing key nothing read', async () => {
    const { LeagueSettingsPanel } = await import('@/app/league/[leagueId]/components/settings/LeagueSettingsPanel')
    render(<LeagueSettingsPanel leagueId="L1" initialData={{ name: 'L', sport: 'NFL' } as never} canEdit save={vi.fn() as never} debouncedSave={vi.fn()} />)
    expect(screen.getByTestId('real-privacy-editor').textContent).toBe('L1')
    expect(screen.queryByText('Listing & discoverability')).toBeNull()
    expect(screen.queryByText('Disable league invite links')).toBeNull()
  })
})
