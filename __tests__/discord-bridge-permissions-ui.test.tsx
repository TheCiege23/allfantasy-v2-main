import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DiscordBridge } from '@/components/core-app/screens/DiscordBridge'
import { BRIDGE_SURFACES, type DiscordBridgeData } from '@/lib/core-app/discordBridge'

/**
 * 32a follow-up — the three states `missingPermissions` can render.
 *
 * These map 1:1 onto the type's own documentation: null with no guild means
 * nothing to check yet, null with a guild means "could not verify" (never
 * silently "fine"), an empty array means current, and a non-empty array must
 * name every missing permission so a commissioner knows exactly what to
 * re-grant.
 */

function baseData(overrides: Partial<DiscordBridgeData>): DiscordBridgeData {
  return {
    leagueId: 'league-1',
    leagueName: 'Test League',
    botConfigured: true,
    connected: true,
    guildName: 'Test Guild',
    guildId: null,
    mappings: BRIDGE_SURFACES.map((surface) => ({
      surface,
      mapped: surface.id === 'league_chat',
      available: surface.id === 'league_chat',
      direction: surface.defaultDirection,
      channelName: surface.id === 'league_chat' ? 'test-league' : null,
      channelUrl: surface.id === 'league_chat' ? 'https://discord.com/channels/1/2' : null,
    })),
    members: [],
    installUrl: 'https://discord.com/oauth2/authorize?client_id=1',
    surfacesPending: true,
    missingPermissions: null,
    ...overrides,
  }
}

describe('DiscordBridge — missing-permissions states', () => {
  it('shows nothing about the install permission grant when no guild is mapped yet', () => {
    /*
     * The unrelated "when it goes wrong" FAQ panel legitimately mentions
     * channel permissions elsewhere on the screen, so this checks specifically
     * for the guild-install status block (`role="status"`/`role="alert"`)
     * rather than any occurrence of the word.
     */
    render(<DiscordBridge data={baseData({ guildId: null, missingPermissions: null })} />)
    expect(screen.queryByText(/could not verify/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/are current/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/is missing permissions/i)).not.toBeInTheDocument()
  })

  it('reports "could not verify" rather than implying the install is fine', () => {
    render(<DiscordBridge data={baseData({ guildId: 'guild-1', missingPermissions: null })} />)
    expect(screen.getByRole('status')).toHaveTextContent(/could not verify/i)
  })

  it('lists every missing permission and points at the fix', () => {
    render(
      <DiscordBridge
        data={baseData({ guildId: 'guild-1', missingPermissions: ['Manage webhooks', 'Embed links'] })}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/missing permissions/i)
    expect(screen.getByText('Manage webhooks')).toBeInTheDocument()
    expect(screen.getByText('Embed links')).toBeInTheDocument()
    expect(alert).toHaveTextContent(/re-running the install link/i)
  })

  it('confirms the grant is current, distinct from "could not verify"', () => {
    render(<DiscordBridge data={baseData({ guildId: 'guild-1', missingPermissions: [] })} />)
    expect(screen.getByText(/permissions.*are current/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
