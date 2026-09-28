/**
 * `/core/discord` and the chat drawer's Discord tab, for everyone in the league (2026-09-25).
 *
 *   - A co-commissioner gets the SETUP screen, the same one the head commissioner gets.
 *   - A member gets a "Join the league Discord" button once an invite is stored — and nothing that
 *     sets anything up.
 *   - Someone outside the league gets neither the screen nor the link.
 *   - The commissioner can paste an invite link; a bad one is refused before it is ever sent.
 *
 * The screen loader runs for real (real `getDiscordBridge`, `getLeagueRole` and
 * `resolveLeagueMembership`) over an in-memory league; only prisma and the browser's fetch are fakes.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LEAGUE = '11111111-2222-4333-8444-555555555555'
const GUILD = '1180313285313167390'
const INVITE = 'https://discord.gg/sundaysquad'

type Team = { claimedByUserId: string; isCommissioner: boolean; isCoCommissioner: boolean; role: string | null }

const h = vi.hoisted(() => ({
  league: null as null | { id: string; name: string; userId: string; sport: string; settings: unknown },
  teams: [] as Team[],
  refresh: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const byId = (where: { id?: string } | undefined) => (h.league && where?.id === h.league.id ? h.league : null)
  return {
    prisma: {
      league: {
        findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => byId(where)),
        findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => byId(where)),
      },
      leagueTeam: {
        findFirst: vi.fn(async ({ where }: { where: { leagueId?: string; claimedByUserId?: string } }) =>
          h.league && where.leagueId === h.league.id
            ? h.teams.find((t) => t.claimedByUserId === where.claimedByUserId) ?? null
            : null,
        ),
        findMany: vi.fn(async () => [
          { teamName: 'Wing Kings', ownerName: 'Priya', claimedByUserId: 'user-member' },
        ]),
      },
      roster: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
      redraftLeagueMember: { findUnique: vi.fn(async () => null) },
      userProfile: {
        findUnique: vi.fn(async () => ({ discordUserId: '1085033561016516730', discordUsername: 'cocomm', discordGuildId: GUILD })),
        findMany: vi.fn(async () => []),
      },
      discordLeagueChannel: { findFirst: vi.fn(async () => null) },
      discordGuildLink: { findUnique: vi.fn(async () => ({ guildName: 'Sunday Squad HQ', linkedByUserId: 'user-co-commish' })) },
    },
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: h.refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/discord',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'user-member' } }, status: 'authenticated' }) }))
vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('@/components/core-app/af-discord.css', () => ({}))

import { loadDiscordBridgeScreen } from '@/lib/core-app/discordBridgeScreen'
import { DiscordBridgeNotice } from '@/components/core-app/screens/DiscordBridgeNotice'
import { DiscordBridge } from '@/components/core-app/screens/DiscordBridge'
import { BRIDGE_SURFACES, type DiscordBridgeData } from '@/lib/core-app/discordBridge'
import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

const SCOPED = { id: LEAGUE, name: 'Sunday Squad' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('DISCORD_BOT_TOKEN', 'x')
  h.league = { id: LEAGUE, name: 'Sunday Squad', userId: 'user-owner', sport: 'NFL', settings: { discordInviteUrl: INVITE } }
  h.teams = [
    { claimedByUserId: 'user-co-commish', isCommissioner: false, isCoCommissioner: true, role: null },
    { claimedByUserId: 'user-member', isCommissioner: false, isCoCommissioner: false, role: null },
  ]
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('loadDiscordBridgeScreen — who gets which screen', () => {
  it('the owner still gets the setup screen, carrying the stored invite', async () => {
    const out = await loadDiscordBridgeScreen('user-owner', SCOPED)
    expect(out.state).toBe('ready')
    expect(out.state === 'ready' && out.data.inviteUrl).toBe(INVITE)
  })

  it('a co-commissioner gets the setup screen too', async () => {
    const out = await loadDiscordBridgeScreen('user-co-commish', SCOPED)
    expect(out.state).toBe('ready')
    expect(out.state === 'ready' && out.data.leagueId).toBe(LEAGUE)
  })

  it('a member gets the join state, with the league’s invite', async () => {
    const out = await loadDiscordBridgeScreen('user-member', SCOPED)
    expect(out).toEqual({ state: 'not-commissioner', league: SCOPED, inviteUrl: INVITE })
  })

  it('a member of a league with no invite yet gets the join state with none', async () => {
    h.league!.settings = { description: 'no discord here' }
    const out = await loadDiscordBridgeScreen('user-member', SCOPED)
    expect(out).toEqual({ state: 'not-commissioner', league: SCOPED, inviteUrl: null })
  })

  it('someone outside the league never gets the invite, or even the league', async () => {
    const out = await loadDiscordBridgeScreen('user-outsider', SCOPED)
    expect(out).toEqual({ state: 'no-league' })
    expect(JSON.stringify(out)).not.toContain('discord.gg')
  })
})

describe('DiscordBridgeNotice — the member’s view', () => {
  it('shows "Join the league Discord", opening the invite in a new tab', () => {
    render(<DiscordBridgeNotice screen={{ state: 'not-commissioner', league: SCOPED, inviteUrl: INVITE }} />)
    const join = screen.getByRole('link', { name: /join the league discord/i })
    expect(join.getAttribute('href')).toBe(INVITE)
    expect(join.getAttribute('target')).toBe('_blank')
    expect(join.getAttribute('rel')).toMatch(/noopener/)
    expect(join.getAttribute('rel')).toMatch(/noreferrer/)
  })

  it('offers a member no setup controls — only the Join button', () => {
    const { container } = render(
      <DiscordBridgeNotice screen={{ state: 'not-commissioner', league: SCOPED, inviteUrl: INVITE }} />,
    )
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.textContent).not.toMatch(/Make the channel|Add AllFantasy|Save link/i)
    expect(container.textContent).not.toMatch(/\bAI\b/)
  })

  it('without an invite, says the commissioner sets it up and shows no link', () => {
    render(<DiscordBridgeNotice screen={{ state: 'not-commissioner', league: SCOPED, inviteUrl: null }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/Sunday Squad/)).toBeTruthy()
    expect(screen.getByText(/commissioner/i)).toBeTruthy()
  })
})

/* ── The setup screen: pasting an invite ─────────────────────────────────── */

function setupData(overrides: Partial<DiscordBridgeData> = {}): DiscordBridgeData {
  return {
    leagueId: LEAGUE,
    leagueName: 'Sunday Squad',
    botConfigured: true,
    connected: true,
    discordUsername: 'cocomm',
    guildName: null,
    guildId: null,
    serverReady: false,
    templateUrl: null,
    inboundAvailable: false,
    installUrl: `/api/discord/bot-install?leagueId=${LEAGUE}`,
    surfacesPending: true,
    inviteUrl: null,
    mappings: BRIDGE_SURFACES.map((surface) => ({
      surface,
      mapped: false,
      available: surface.id === 'league_chat',
      direction: surface.defaultDirection,
      channelName: null,
      channelUrl: null,
    })),
    members: [],
    ...overrides,
  }
}

const json = (value: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }))

describe('DiscordBridge — the commissioner pastes an invite link', () => {
  it('saves a valid link through PATCH and shows it back, ready to copy', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      url === '/api/discord/league' && init?.method === 'PATCH'
        ? json({ ok: true, inviteUrl: INVITE })
        : json({}, 404),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<DiscordBridge data={setupData()} />)
    const input = screen.getByRole('textbox', { name: /invite link/i })
    fireEvent.change(input, { target: { value: INVITE } })
    fireEvent.click(screen.getByRole('button', { name: /save link/i }))
    await waitFor(() => expect(screen.getByText(INVITE)).toBeTruthy())
    const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
    expect(JSON.parse(String(call[1]!.body))).toEqual({ leagueId: LEAGUE, inviteUrl: INVITE })
  })

  it('refuses a link that is not a Discord invite, without sending it', async () => {
    const fetchMock = vi.fn(() => json({}, 404))
    vi.stubGlobal('fetch', fetchMock)
    render(<DiscordBridge data={setupData()} />)
    fireEvent.change(screen.getByRole('textbox', { name: /invite link/i }), {
      target: { value: 'https://evil.example/sundaysquad' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save link/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/discord\.gg/)
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'PATCH')).toBe(false)
  })

  it('says what the server said when it refuses the link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        init?.method === 'PATCH'
          ? json({ error: 'Only the commissioner or a co-commissioner can change this.' }, 403)
          : json({}, 404),
      ),
    )
    render(<DiscordBridge data={setupData()} />)
    fireEvent.change(screen.getByRole('textbox', { name: /invite link/i }), { target: { value: INVITE } })
    fireEvent.click(screen.getByRole('button', { name: /save link/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/co-commissioner/)
    expect(screen.queryByText(INVITE)).toBeNull()
  })

  it('shows a stored link and can remove it', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({ ok: true, inviteUrl: null }) : json({}, 404),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<DiscordBridge data={setupData({ inviteUrl: INVITE })} />)
    expect(screen.getByText(INVITE)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /remove the link/i }))
    await waitFor(() => expect(screen.queryByText(INVITE)).toBeNull())
    const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!
    expect(JSON.parse(String(call[1]!.body))).toEqual({ leagueId: LEAGUE, inviteUrl: null })
  })
})

/* ── The chat drawer's Discord tab ───────────────────────────────────────── */

function openDrawer(status: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).startsWith('/api/discord/league')
        ? { ok: true, status: 200, json: async () => status }
        : { ok: true, status: 200, json: async () => ({}) },
    ),
  )
  Element.prototype.scrollIntoView = vi.fn()
  sessionStorage.clear()
  render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={[{ id: LEAGUE, name: 'Sunday Squad', platform: 'native', platformLeagueId: null }] as never}
      pageLeagueId={LEAGUE}
      chimmyTokenCost={9}
      initialTab="discord"
      userId="user-member"
    />,
  )
}

describe('the drawer’s Discord tab', () => {
  it('a member sees "Join the league Discord" as soon as an invite is stored — no channel needed', async () => {
    openDrawer({ botConfigured: false, isCommissioner: false, missingPermissions: null, inviteUrl: INVITE, channel: null })
    const join = await screen.findByRole('link', { name: /join the league discord/i })
    expect(join.getAttribute('href')).toBe(INVITE)
    expect(join.getAttribute('target')).toBe('_blank')
    expect(screen.queryByRole('link', { name: /manage discord|set up discord/i })).toBeNull()
  })

  it('with a channel too, the member gets Join and Open channel, and still no Manage', async () => {
    openDrawer({
      botConfigured: true,
      isCommissioner: false,
      missingPermissions: [],
      inviteUrl: INVITE,
      channel: { channelName: 'sunday-squad', guildName: 'Sunday Squad HQ', channelUrl: `https://discord.com/channels/${GUILD}/1` },
    })
    const panel = await screen.findByText(/#sunday-squad/)
    const scope = within(panel.closest('.af-cm-panel') as HTMLElement)
    expect(scope.getByRole('link', { name: /join the league discord/i }).getAttribute('href')).toBe(INVITE)
    expect(scope.getByRole('link', { name: /open channel/i })).toBeTruthy()
    expect(scope.queryByRole('link', { name: /manage discord/i })).toBeNull()
  })

  it('no invite stored: the member is told plainly, with no link to follow', async () => {
    openDrawer({ botConfigured: true, isCommissioner: false, missingPermissions: null, inviteUrl: null, channel: null })
    expect(await screen.findByText(/No Discord yet for Sunday Squad/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /join/i })).toBeNull()
  })
})
