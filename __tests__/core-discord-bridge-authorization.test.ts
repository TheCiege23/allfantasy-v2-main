/**
 * `getDiscordBridge` — owner-only, and narrower than league membership on purpose.
 *
 * 🛑 THE COMMIT THAT REWROTE THIS GATE SHIPPED NO ASSERTION OF IT. `d5fce3c3a`
 * replaced `findFirst({ where: { id } })` + `league.userId !== userId` with
 * `findFirst({ where: { id, userId } })` and attested to a 30-case equivalence
 * probe run by hand against a live database — not committed, not reproducible,
 * and it tested the empty string rather than `undefined`, which is the input
 * that actually diverges. This file is that evidence, in the repo.
 *
 * ⚠ WHY NOT `loadLeagueFor`. That helper admits all four canonical membership
 * paths (owner, RedraftLeagueMember, roster-backed, claimed team). This screen
 * configures what relays into a public Discord channel for the whole league, so
 * routing it through `loadLeagueFor` would hand those controls to every manager.
 * The narrower predicate is the point, and the test for "a member who is not the
 * owner is refused" is what stops a future consistency pass from widening it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  profileFindUnique: vi.fn(),
  profileFindMany: vi.fn(),
  channelFindFirst: vi.fn(),
  teamFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: mocks.leagueFindFirst },
    userProfile: { findUnique: mocks.profileFindUnique, findMany: mocks.profileFindMany },
    discordLeagueChannel: { findFirst: mocks.channelFindFirst },
    leagueTeam: { findMany: mocks.teamFindMany },
  },
}))

vi.mock('@/lib/discord/bot', () => ({ isBotConfigured: () => true }))
vi.mock('@/lib/discord/deepLinks', () => ({ channelLink: () => 'https://discord.com/channels/1/2' }))
vi.mock('@/lib/discord/constants', () => ({
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_BOT_PERMISSIONS: '0',
}))

import { getDiscordBridge } from '@/lib/core-app/discordBridge'

const LEAGUE_ID = 'league-under-test'
const OWNER = 'app-user-uuid-owner'
const MEMBER = 'app-user-uuid-member'

/** The gate's own read, once membership is proved. */
const LEAGUE_ROW = { id: LEAGUE_ID, name: 'Someone Else’s Dynasty' }

beforeEach(() => {
  vi.clearAllMocks()
  // Default: the scoped `where` matches nothing, i.e. the viewer is not the owner.
  mocks.leagueFindFirst.mockResolvedValue(null)
  mocks.profileFindUnique.mockResolvedValue(null)
  mocks.profileFindMany.mockResolvedValue([])
  mocks.channelFindFirst.mockResolvedValue(null)
  mocks.teamFindMany.mockResolvedValue([])
})

describe('refuses anyone who is not the league owner', () => {
  it('refuses a signed-in non-owner and reads nothing else', async () => {
    await expect(getDiscordBridge(MEMBER, LEAGUE_ID)).resolves.toBeNull()
    /*
     * The League probe may run; nothing downstream may. The disclosure this
     * screen carries is not the refusal — it is the guild, the mapped channel,
     * and every claimed manager's Discord username and avatar.
     */
    expect(mocks.teamFindMany, 'team roster was read despite a refusal').not.toHaveBeenCalled()
    expect(mocks.channelFindFirst, 'channel mapping was read despite a refusal').not.toHaveBeenCalled()
    expect(mocks.profileFindMany, 'member Discord identities were read despite a refusal').not.toHaveBeenCalled()
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
  ])('refuses a %s userId without querying at all', async (_label, value) => {
    /*
     * 🛑 THIS IS THE CASE THE HAND-RUN PROBE MISSED, AND THE ONLY ONE WHERE THE
     * TWO IMPLEMENTATIONS EVER DIVERGED. Prisma DROPS a `where` field whose
     * value is `undefined`, so `where: { id, userId: undefined }` degrades to
     * `where: { id }` and returns the league to ANY caller — where the old
     * read-then-compare (`league.userId !== undefined`) refused.
     *
     * Asserting `not.toHaveBeenCalled()` rather than just a null return is what
     * makes this test real: a version that queried and then filtered would
     * return null here too, while still being one Prisma quirk away from
     * handing over the row.
     */
    await expect(getDiscordBridge(value as unknown as string, LEAGUE_ID)).resolves.toBeNull()
    expect(mocks.leagueFindFirst, 'the League table was queried for a nullish viewer').not.toHaveBeenCalled()
  })

  it('refuses a missing league', async () => {
    await expect(getDiscordBridge(OWNER, 'no-such-league')).resolves.toBeNull()
    expect(mocks.teamFindMany).not.toHaveBeenCalled()
  })
})

describe('admits the owner', () => {
  beforeEach(() => {
    mocks.leagueFindFirst.mockResolvedValue(LEAGUE_ROW)
  })

  it('returns the bridge for the league owner', async () => {
    const data = await getDiscordBridge(OWNER, LEAGUE_ID)
    expect(data).not.toBeNull()
    expect(data?.leagueId).toBe(LEAGUE_ID)
    expect(data?.leagueName).toBe(LEAGUE_ROW.name)
  })

  it('scopes the League read to the viewer, in the query', async () => {
    await getDiscordBridge(OWNER, LEAGUE_ID)
    expect(mocks.leagueFindFirst).toHaveBeenCalledWith({
      where: { id: LEAGUE_ID, userId: OWNER },
      select: { id: true, name: true },
    })
  })

  it('scopes the channel read to league_chat', async () => {
    /*
     * ⚠ `@@unique([leagueId, surface])` permits four rows per league, and every
     * row that comes back is rendered under the League chat heading. An
     * unfiltered `findFirst` could therefore print the commissioner-notes
     * channel's name, URL and direction as if it were league chat — which is the
     * "private note in a public channel" failure the contract file names.
     */
    await getDiscordBridge(OWNER, LEAGUE_ID)
    expect(mocks.channelFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: LEAGUE_ID, surface: 'league_chat' } })
    )
  })

  it('reports every non-league_chat surface as unavailable, not merely unmapped', async () => {
    /*
     * The outbound relay has no notion of a surface, so mapping one would write
     * a row nothing posts to. `available: false` is what makes the screen say
     * why instead of rendering three dead controls.
     */
    const data = await getDiscordBridge(OWNER, LEAGUE_ID)
    const others = (data?.mappings ?? []).filter((m) => m.surface.id !== 'league_chat')
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((m) => !m.available)).toBe(true)
    expect(data?.surfacesPending).toBe(true)
  })

  it('keeps commissioner-only surfaces defaulted to off', async () => {
    /*
     * 🛑 THIS CONSTANT IS THE ONLY PLACE THE SAFETY DEFAULT ACTUALLY LIVES.
     * The docblock used to claim the migration's column default said the same;
     * it does not — `20260823120000_discord_bridge_surfaces` adds only
     * `commissionerOnly BOOLEAN DEFAULT false` and never touches the direction
     * columns, which default to post-only.
     */
    const data = await getDiscordBridge(OWNER, LEAGUE_ID)
    const commissionerOnly = (data?.mappings ?? []).filter((m) => m.surface.commissionerOnly)
    expect(commissionerOnly.length).toBeGreaterThan(0)
    expect(commissionerOnly.every((m) => m.surface.defaultDirection === 'off')).toBe(true)
  })
})
