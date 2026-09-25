/**
 * /core/discord — the guided "give your league its own Discord" screen.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ refresh: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: nav.refresh, push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => nav.params,
}))
vi.mock('@/components/core-app/af-discord.css', () => ({}))

import { DiscordBridge } from '@/components/core-app/screens/DiscordBridge'
import { BRIDGE_SURFACES, type DiscordBridgeData } from '@/lib/core-app/discordBridge'

const GUILD = '1180313285313167390'

function data(overrides: Partial<DiscordBridgeData> = {}, channel?: { direction: 'off' | 'post-only' | 'both' }): DiscordBridgeData {
  return {
    leagueId: 'league_1',
    leagueName: 'Iron Horse Dynasty',
    botConfigured: true,
    connected: true,
    discordUsername: 'guap',
    guildName: 'Iron Horse',
    guildId: GUILD,
    serverReady: true,
    templateUrl: null,
    inboundAvailable: false,
    installUrl: '/api/discord/bot-install?leagueId=league_1',
    surfacesPending: true,
    mappings: BRIDGE_SURFACES.map((surface) =>
      surface.id === 'league_chat' && channel
        ? {
            surface,
            mapped: true,
            available: true,
            direction: channel.direction,
            channelName: 'iron-horse-dynasty',
            channelUrl: `https://discord.com/channels/${GUILD}/1200000000000000002`,
          }
        : { surface, mapped: false, available: surface.id === 'league_chat', direction: surface.defaultDirection, channelName: null, channelUrl: null },
    ),
    members: [
      { teamName: 'Priya FC', ownerName: 'Priya', linked: true, discordUsername: 'priya', discordAvatar: null },
      { teamName: 'Marcus Mob', ownerName: 'Marcus', linked: false, discordUsername: null, discordAvatar: null },
    ],
    ...overrides,
  }
}

const fetchMock = vi.fn()
const json = (value: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  vi.resetAllMocks()
  nav.params = new URLSearchParams()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/discord/league?')) {
      return json({
        inviteUrl: 'https://discord.gg/abc123',
        missingPermissions: [],
        channel: {
          channelName: 'iron-horse-dynasty',
          channelUrl: `https://discord.com/channels/${GUILD}/1200000000000000002`,
          visibility: 'server',
        },
      })
    }
    if (String(url) === '/api/discord/league' && init?.method === 'PATCH') return json({ ok: true })
    if (String(url) === '/api/discord/channels/create') {
      return json({
        channelName: 'iron-horse-dynasty',
        channelUrl: `https://discord.com/channels/${GUILD}/1200000000000000002`,
        visibility: 'private',
        inviteUrl: 'https://discord.gg/abc123',
        access: { included: ['You', 'Priya'], notLinked: ['Marcus'], notInServer: [], unknown: [] },
        alreadyExisted: false,
      })
    }
    return json({}, 404)
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('the steps', () => {
  it('starts with connecting Discord, in a new tab, and the add button waits for it', () => {
    render(<DiscordBridge data={data({ connected: false, serverReady: false, guildId: null, guildName: null })} />)
    const connect = screen.getByRole('link', { name: /connect discord/i })
    expect(connect.getAttribute('href')).toBe('/api/auth/discord')
    expect(connect.getAttribute('target')).toBe('_blank')
    expect(screen.getByRole('button', { name: /add allfantasy to my server/i })).toHaveProperty('disabled', true)
  })

  it('re-reads itself when the commissioner comes back from connecting', () => {
    render(<DiscordBridge data={data({ connected: false, serverReady: false })} />)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(nav.refresh).toHaveBeenCalled()
  })

  it('offers the one-tap template when the owner has set one up', () => {
    render(<DiscordBridge data={data({ serverReady: false, templateUrl: 'https://discord.new/hK8bYk3XwZ9m' })} />)
    expect(screen.getByRole('link', { name: /create the server in discord/i }).getAttribute('href')).toBe(
      'https://discord.new/hK8bYk3XwZ9m',
    )
  })

  it('falls back to Discord’s own three taps without a template', () => {
    render(<DiscordBridge data={data({ serverReady: false })} />)
    expect(screen.getByText(/Create My Own/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /open discord/i }).getAttribute('href')).toBe('https://discord.com/channels/@me')
  })

  it('adds AllFantasy through the real install round trip, not a bare discord.com link', () => {
    render(<DiscordBridge data={data({ serverReady: false })} />)
    const add = screen.getByRole('link', { name: /add allfantasy to my server/i })
    expect(add.getAttribute('href')).toBe('/api/discord/bot-install?leagueId=league_1')
    expect(add.getAttribute('target')).toBeNull()
  })

  it('says so clearly when Discord sends the commissioner back with the server added', () => {
    nav.params = new URLSearchParams('league=league_1&discord=bot-linked')
    render(<DiscordBridge data={data()} />)
    expect(screen.getByRole('status').textContent).toMatch(/AllFantasy is in your server/)
  })

  it('makes a members-only channel when asked, and says who could not be let in', async () => {
    render(<DiscordBridge data={data()} />)
    fireEvent.click(screen.getByRole('radio', { name: /only league members/i }))
    fireEvent.click(screen.getByRole('button', { name: /make the channel/i }))
    await waitFor(() => expect(screen.getByText(/Members only/)).toBeTruthy())
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/discord/channels/create')!
    expect(JSON.parse(call[1].body)).toEqual({ leagueId: 'league_1', guildId: GUILD, visibility: 'private' })
    expect(screen.getByText(/Haven’t linked Discord: Marcus/)).toBeTruthy()
    expect(screen.getByText('https://discord.gg/abc123')).toBeTruthy()
  })
})

describe('copying is the commissioner’s call', () => {
  it('shows copying off by default and turns it on as post-only', async () => {
    render(<DiscordBridge data={data({}, { direction: 'off' })} />)
    const copy = screen.getByRole('switch', { name: /copy allfantasy league chat into discord/i })
    expect(copy.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(copy)
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true))
    const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({
      leagueId: 'league_1',
      surface: 'league_chat',
      syncEnabled: true,
      syncOutbound: true,
      syncInbound: false,
    })
    expect(copy.getAttribute('aria-checked')).toBe('true')
  })

  it('does not offer two-way while nothing runs it', () => {
    render(<DiscordBridge data={data({}, { direction: 'post-only' })} />)
    const twoWay = screen.getByRole('switch', { name: /bring discord messages into allfantasy/i })
    expect(twoWay).toHaveProperty('disabled', true)
    expect(twoWay.getAttribute('aria-checked')).toBe('false')
    expect(screen.getAllByText(/not available yet/i).length).toBeGreaterThan(0)
  })

  it('puts the switch back and says so when the save fails', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({ error: 'nope' }, 500) : json({}, 404),
    )
    render(<DiscordBridge data={data({}, { direction: 'off' })} />)
    const copy = screen.getByRole('switch', { name: /copy allfantasy league chat into discord/i })
    fireEvent.click(copy)
    await waitFor(() => expect(screen.getByText(/Not saved/)).toBeTruthy())
    expect(copy.getAttribute('aria-checked')).toBe('false')
  })
})

describe('honest copy', () => {
  it('never promises messages are "never dropped", and says what AllFantasy does not read', () => {
    const { container } = render(<DiscordBridge data={data({}, { direction: 'off' })} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/never dropped/i)
    expect(text).toMatch(/We don’t read your Discord chats/)
    expect(text).toMatch(/Server owners and admins can read every channel/)
    // Customer copy names Chimmy, never a bare "AI".
    expect(text).not.toMatch(/\bAI\b/)
  })
})
