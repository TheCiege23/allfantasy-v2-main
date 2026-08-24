import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 32a follow-up — the Discord bridge screen's missing-permissions state.
 *
 * `getBotUserId` caches its result at module scope (see lib/discord/bot.ts),
 * so each test resets modules and re-imports rather than reusing one bot
 * instance across cases — otherwise a later test silently reuses an earlier
 * test's cached bot id regardless of what that test's fetch mock returns.
 */

const VIEW_CHANNEL = 1n << 10n
const SEND_MESSAGES = 1n << 11n
const MANAGE_WEBHOOKS = 1n << 29n
const ADMINISTRATOR = 1n << 3n

async function freshBotModule() {
  vi.resetModules()
  return import('@/lib/discord/bot')
}

function mockFetchSequence(responses: Array<{ ok: boolean; json?: unknown }>) {
  const impl = vi.fn()
  for (const r of responses) {
    impl.mockImplementationOnce(async () => ({
      ok: r.ok,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json ?? {}),
    }))
  }
  vi.stubGlobal('fetch', impl)
  return impl
}

beforeEach(() => {
  process.env.DISCORD_BOT_TOKEN = 'test-token'
})

afterEach(() => {
  delete process.env.DISCORD_BOT_TOKEN
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('missingBotPermissions', () => {
  it('returns null — unknown, not "fine" — when the bot token is unset', async () => {
    delete process.env.DISCORD_BOT_TOKEN
    const { missingBotPermissions } = await freshBotModule()
    expect(await missingBotPermissions('guild-1')).toBeNull()
  })

  it('returns null when Discord cannot be reached, never an empty (passing) array', async () => {
    mockFetchSequence([
      { ok: true, json: { id: 'bot-1' } }, // /users/@me
      { ok: false }, // /guilds/:id/roles fails
      { ok: true, json: { roles: [] } },
    ])
    const { missingBotPermissions } = await freshBotModule()
    expect(await missingBotPermissions('guild-1')).toBeNull()
  })

  it('lists every REQUIRED_BOT_PERMISSIONS label the install lacks', async () => {
    // @everyone (role id === guild id) holds VIEW_CHANNEL + SEND_MESSAGES only.
    mockFetchSequence([
      { ok: true, json: { id: 'bot-1' } },
      { ok: true, json: [{ id: 'guild-1', permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }] },
      { ok: true, json: { roles: [] } },
    ])
    const { missingBotPermissions, REQUIRED_BOT_PERMISSIONS } = await freshBotModule()
    const missing = await missingBotPermissions('guild-1')
    expect(missing).not.toBeNull()
    // Everything except View channels and Send messages is missing.
    const expected = REQUIRED_BOT_PERMISSIONS.filter(
      (p) => p.bit !== VIEW_CHANNEL && p.bit !== SEND_MESSAGES,
    ).map((p) => p.label)
    expect(missing).toEqual(expected)
  })

  it('returns an empty array — not null — once the grant is current', async () => {
    mockFetchSequence([
      { ok: true, json: { id: 'bot-1' } },
      {
        ok: true,
        json: [
          {
            id: 'guild-1',
            // Every bit REQUIRED_BOT_PERMISSIONS asks for, OR'd together.
            permissions: String(
              (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 16n) | (1n << 4n) | (1n << 29n),
            ),
          },
        ],
      },
      { ok: true, json: { roles: [] } },
    ])
    const { missingBotPermissions } = await freshBotModule()
    expect(await missingBotPermissions('guild-1')).toEqual([])
  })

  it('treats ADMINISTRATOR as satisfying every required permission', async () => {
    mockFetchSequence([
      { ok: true, json: { id: 'bot-1' } },
      { ok: true, json: [{ id: 'guild-1', permissions: String(ADMINISTRATOR) }] },
      { ok: true, json: { roles: [] } },
    ])
    const { missingBotPermissions } = await freshBotModule()
    expect(await missingBotPermissions('guild-1')).toEqual([])
  })

  it("sums permissions across every role the bot holds, including @everyone", async () => {
    mockFetchSequence([
      { ok: true, json: { id: 'bot-1' } },
      {
        ok: true,
        json: [
          { id: 'guild-1', permissions: String(VIEW_CHANNEL) }, // @everyone
          { id: 'bot-role', permissions: String(SEND_MESSAGES | MANAGE_WEBHOOKS) },
          { id: 'unrelated-role', permissions: String(1n << 20n) }, // not held by the bot
        ],
      },
      { ok: true, json: { roles: ['bot-role'] } },
    ])
    const { missingBotPermissions } = await freshBotModule()
    const missing = await missingBotPermissions('guild-1')
    // Held: View channels, Send messages, Manage webhooks. Still missing the rest.
    expect(missing).toContain('Embed links')
    expect(missing).toContain('Attach files')
    expect(missing).toContain('Read message history')
    expect(missing).toContain('Manage channels')
    expect(missing).not.toContain('View channels')
    expect(missing).not.toContain('Send messages')
    expect(missing).not.toContain('Manage webhooks')
  })

  it('ignores a role with a malformed permissions bitfield rather than throwing', async () => {
    mockFetchSequence([
      { ok: true, json: { id: 'bot-1' } },
      { ok: true, json: [{ id: 'guild-1', permissions: 'not-a-number' }] },
      { ok: true, json: { roles: [] } },
    ])
    const { missingBotPermissions } = await freshBotModule()
    await expect(missingBotPermissions('guild-1')).resolves.not.toBeNull()
  })
})
