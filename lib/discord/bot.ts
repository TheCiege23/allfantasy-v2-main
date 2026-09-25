/**
 * Discord REST API (v10) — bot token only. No discord.js (serverless-friendly).
 */

const DISCORD_BASE = 'https://discord.com/api/v10'

export type DiscordEmbed = {
  title?: string
  description?: string
  color?: number
  author?: { name: string; icon_url?: string }
  image?: { url: string }
  footer?: { text: string }
  timestamp?: string
}

function botHeaders(): HeadersInit {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set')
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  }
}

export function isBotConfigured(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN?.trim())
}

/**
 * A Discord REST failure with its HTTP status kept, so a route can tell "the bot is
 * not allowed to do that here" (403) from "Discord is down" (5xx) without parsing a
 * message. The message never carries the bot token — only the path's status and a
 * short slice of Discord's own error body.
 */
export class DiscordApiError extends Error {
  readonly status: number
  constructor(label: string, status: number, detail = '') {
    super(`${label}: ${status}${detail ? ` ${detail.slice(0, 200)}` : ''}`)
    this.name = 'DiscordApiError'
    this.status = status
  }
}

/**
 * The longest we will wait on a rate limit before giving up on a message. A relay
 * runs inside somebody's chat send, so a long Discord cooldown is not worth holding
 * that request open for — the message is safe in AllFantasy either way.
 */
export const MAX_RETRY_WAIT_MS = 3_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * One request, retried ONCE when Discord says "slow down" (429) or has a server
 * error (5xx). Never more than once and never longer than MAX_RETRY_WAIT_MS, so the
 * worst case is bounded. Anything else — 400, 403, 404 — is returned as-is: retrying
 * a refusal only repeats it.
 */
async function sendOnceWithRetry(url: string, init: RequestInit): Promise<Response> {
  const first = await fetch(url, init)
  if (first.status !== 429 && first.status < 500) return first
  let waitMs = 1_000
  if (first.status === 429) {
    const body = (await first.clone().json().catch(() => null)) as { retry_after?: unknown } | null
    const seconds = Number(body?.retry_after ?? first.headers.get('retry-after'))
    if (Number.isFinite(seconds) && seconds >= 0) waitMs = Math.ceil(seconds * 1000)
  }
  if (waitMs > MAX_RETRY_WAIT_MS) return first
  await sleep(waitMs)
  return fetch(url, init)
}

let cachedBotUserId: string | null = null

/** Bot's own user id (for loop prevention when polling messages). */
export async function getBotUserId(): Promise<string | null> {
  if (cachedBotUserId) return cachedBotUserId
  if (!isBotConfigured()) return null
  const res = await fetch(`${DISCORD_BASE}/users/@me`, { headers: botHeaders() })
  if (!res.ok) return null
  const data = (await res.json()) as { id?: string }
  if (data.id) {
    cachedBotUserId = data.id
    return data.id
  }
  return null
}

type DiscordChannel = {
  id: string
  name?: string
  type: number
  parent_id?: string | null
}

export async function ensureCategory(guildId: string): Promise<string> {
  const res = await fetch(`${DISCORD_BASE}/guilds/${guildId}/channels`, { headers: botHeaders() })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new DiscordApiError('ensureCategory', res.status, t)
  }
  const channels = (await res.json()) as DiscordChannel[]
  const existing = channels.find((c) => c.type === 4 && c.name === 'AllFantasy Leagues')
  if (existing?.id) return existing.id

  const create = await fetch(`${DISCORD_BASE}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({
      name: 'AllFantasy Leagues',
      type: 4,
    }),
  })
  if (!create.ok) {
    const t = await create.text().catch(() => '')
    throw new DiscordApiError('create category', create.status, t)
  }
  const cat = (await create.json()) as { id: string }
  return cat.id
}

function slugifyLeagueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 99) || 'league-chat'
}

export type PermissionOverwrite = { id: string; type: number; allow: string; deny: string }

/**
 * Creates the league's text channel under an "AllFantasy Leagues" category.
 *
 * With `permissionOverwrites` (from `privateChannelOverwrites`) the channel is
 * members-only FROM THE FIRST MOMENT it exists. That matters: creating it open and
 * locking it afterwards would leave a window where the whole server can read it, and
 * editing overwrites after creation needs MANAGE_ROLES, which the bot does not ask for.
 * Creating with overwrites needs only MANAGE_CHANNELS plus the bits being granted,
 * all of which the install link requests.
 */
export async function createLeagueChannel(
  guildId: string,
  leagueName: string,
  opts: { permissionOverwrites?: PermissionOverwrite[] } = {}
): Promise<{ channelId: string; channelName: string }> {
  const parentId = await ensureCategory(guildId)
  const name = slugifyLeagueName(leagueName)
  const res = await fetch(`${DISCORD_BASE}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({
      type: 0,
      name,
      parent_id: parentId,
      topic: 'Linked to AllFantasy.ai — your league, your space 🏈',
      ...(opts.permissionOverwrites ? { permission_overwrites: opts.permissionOverwrites } : {}),
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new DiscordApiError('createLeagueChannel', res.status, t)
  }
  const ch = (await res.json()) as { id: string; name?: string }
  return { channelId: ch.id, channelName: ch.name ?? name }
}

export type DiscordChannelInfo = {
  id: string
  name: string | null
  guildId: string | null
  overwrites: PermissionOverwrite[]
}

/**
 * One channel as Discord sees it now. Null means Discord says it is GONE (404). Any
 * other failure throws — including 403, which means the bot can no longer see it (hidden
 * from the bot, or the bot was removed) rather than that it was deleted. A caller must
 * never mistake either "Discord is down" or "we are locked out" for "make a new one".
 */
export async function getChannel(channelId: string): Promise<DiscordChannelInfo | null> {
  const res = await fetch(`${DISCORD_BASE}/channels/${channelId}`, { headers: botHeaders(), cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new DiscordApiError('getChannel', res.status)
  const ch = (await res.json()) as {
    id: string
    name?: string | null
    guild_id?: string | null
    permission_overwrites?: PermissionOverwrite[]
  }
  return {
    id: ch.id,
    name: ch.name ?? null,
    guildId: ch.guild_id ?? null,
    overwrites: Array.isArray(ch.permission_overwrites) ? ch.permission_overwrites : [],
  }
}

const VIEW_CHANNEL_BIT = 1n << 10n

/**
 * Members-only or open to the whole server, read from the channel's own overwrites:
 * the @everyone overwrite (whose id is the guild id) denying View Channel is what
 * makes a channel private in Discord. Read live, so a commissioner who changes it in
 * Discord sees the truth here rather than what we set on day one.
 */
export function channelVisibility(info: DiscordChannelInfo, guildId: string): 'private' | 'server' {
  const everyone = info.overwrites.find((o) => o.id === guildId && Number(o.type) === 0)
  if (!everyone) return 'server'
  try {
    return (BigInt(everyone.deny) & VIEW_CHANNEL_BIT) === VIEW_CHANNEL_BIT ? 'private' : 'server'
  } catch {
    return 'server'
  }
}

/**
 * Is this Discord user in this server right now? true / false, or null when Discord
 * could not answer — which a caller must treat as "unknown", never as "no".
 * Fetching ONE member needs no privileged intent (listing all members would).
 */
export async function isGuildMember(guildId: string, discordUserId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${DISCORD_BASE}/guilds/${guildId}/members/${discordUserId}`, {
      headers: botHeaders(),
      cache: 'no-store',
    })
    if (res.ok) return true
    if (res.status === 404) return false
    return null
  } catch {
    return null
  }
}

/** Server owners and administrators retain access under Discord's permission model. */
export function privateChannelOverwrites(guildId: string, botId: string, memberIds: string[]) {
  if (![guildId, botId, ...memberIds].every(id => /^\d{17,20}$/.test(id))) throw new Error('Invalid Discord identity')
  const readWrite = (1024n | 2048n | 16384n | 32768n | 65536n).toString()
  const members = [...new Set([botId, ...memberIds])]
  if (members.length > 99) throw new Error('Too many private channel members')
  return [
    { id: guildId, type: 0, deny: '1024', allow: '0' },
    ...members.map(id => ({ id, type: 1, deny: '0', allow: readWrite })),
  ]
}

export async function postMessage(
  channelId: string,
  content: string,
  embeds?: DiscordEmbed[]
): Promise<string> {
  const payload: Record<string, unknown> = {}
  if (content) payload.content = content
  else if (embeds?.length) payload.content = '\u200b'
  else payload.content = ''
  payload.embeds = embeds?.length ? embeds : []
  const res = await sendOnceWithRetry(`${DISCORD_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new DiscordApiError('postMessage', res.status, t)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export async function postLeagueChatEmbed(
  channelId: string,
  opts: {
    authorName: string
    authorAvatar?: string
    text: string
    gifUrl?: string
    leagueName: string
    leagueId: string
  }
): Promise<string> {
  const embed: DiscordEmbed = {
    author: {
      name: opts.authorName,
      ...(opts.authorAvatar ? { icon_url: opts.authorAvatar } : {}),
    },
    description: opts.text,
    color: 0x06b6d4,
    footer: { text: `${opts.leagueName} · AllFantasy.ai` },
    timestamp: new Date().toISOString(),
    ...(opts.gifUrl ? { image: { url: opts.gifUrl } } : {}),
  }
  return postMessage(channelId, '', [embed])
}

export async function postNotificationEmbed(
  channelId: string,
  _type: 'trade' | 'waiver' | 'injury' | 'chimmy',
  title: string,
  description: string,
  color = 0x5865f2
): Promise<void> {
  await postMessage(channelId, '', [
    {
      title,
      description,
      color,
      timestamp: new Date().toISOString(),
    },
  ])
}

export async function createWebhook(
  channelId: string,
  name = 'AllFantasy'
): Promise<{ id: string; token: string }> {
  const res = await fetch(`${DISCORD_BASE}/channels/${channelId}/webhooks`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new DiscordApiError('createWebhook', res.status, t)
  }
  const w = (await res.json()) as { id: string; token: string }
  return { id: w.id, token: w.token }
}

export type DiscordApiMessage = {
  id: string
  content: string
  author?: { id: string; username?: string; global_name?: string | null; avatar?: string | null }
  embeds?: unknown[]
}

export async function fetchChannelMessages(
  channelId: string,
  query: { after?: string; limit?: number }
): Promise<DiscordApiMessage[]> {
  const u = new URL(`${DISCORD_BASE}/channels/${channelId}/messages`)
  if (query.after) u.searchParams.set('after', query.after)
  u.searchParams.set('limit', String(Math.min(query.limit ?? 10, 10)))
  const res = await fetch(u.toString(), { headers: botHeaders() })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`fetchChannelMessages: ${res.status} ${t.slice(0, 200)}`)
  }
  return (await res.json()) as DiscordApiMessage[]
}

/**
 * The permissions our install link asks for. A server that added the bot before
 * DISCORD_BOT_PERMISSIONS was corrected holds only SEND_MESSAGES + MANAGE_WEBHOOKS,
 * and Discord never upgrades a grant retroactively — that server has to re-run the
 * install link before channel creation or message polling can work there.
 */
export const REQUIRED_BOT_PERMISSIONS: ReadonlyArray<{ label: string; bit: bigint }> = [
  { label: 'View channels', bit: 1n << 10n },
  { label: 'Send messages', bit: 1n << 11n },
  { label: 'Embed links', bit: 1n << 14n },
  { label: 'Attach files', bit: 1n << 15n },
  { label: 'Read message history', bit: 1n << 16n },
  { label: 'Manage channels', bit: 1n << 4n },
  { label: 'Manage webhooks', bit: 1n << 29n },
  { label: 'Create invite', bit: 1n << 0n },
]

const ADMINISTRATOR_BIT = 1n << 3n

type DiscordRole = { id: string; permissions: string }

/**
 * Guild-level permissions the bot actually holds: the OR of every role it has,
 * including @everyone (whose role id is the guild id). Channel overwrites are not
 * applied — this answers "what did the install grant", not "can it post in this
 * exact channel". Returns null when Discord cannot be reached or the bot is gone.
 */
export async function getGuildBotPermissions(guildId: string): Promise<bigint | null> {
  if (!isBotConfigured()) return null
  const botId = await getBotUserId()
  if (!botId) return null

  const [rolesRes, memberRes] = await Promise.all([
    fetch(`${DISCORD_BASE}/guilds/${guildId}/roles`, { headers: botHeaders() }),
    fetch(`${DISCORD_BASE}/guilds/${guildId}/members/${botId}`, { headers: botHeaders() }),
  ])
  if (!rolesRes.ok || !memberRes.ok) return null

  const roles = (await rolesRes.json()) as DiscordRole[]
  const member = (await memberRes.json()) as { roles?: string[] }
  const held = new Set([guildId, ...(member.roles ?? [])])

  let bits = 0n
  for (const role of Array.isArray(roles) ? roles : []) {
    if (!held.has(role.id)) continue
    try {
      bits |= BigInt(role.permissions)
    } catch {
      // Malformed bitfield from the API — ignore this role rather than fail the check.
    }
  }
  return bits
}

/**
 * Labels of the required permissions a guild's install is missing. An empty array
 * means the grant is current; null means we could not determine it, which the UI
 * must treat as "unknown" rather than "fine".
 */
export async function missingBotPermissions(guildId: string): Promise<string[] | null> {
  const bits = await getGuildBotPermissions(guildId)
  if (bits === null) return null
  if ((bits & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT) return []
  return REQUIRED_BOT_PERMISSIONS.filter((p) => (bits & p.bit) !== p.bit).map((p) => p.label)
}

type DiscordInvite = {
  code: string
  max_age: number
  max_uses: number
  temporary: boolean
}

/**
 * A "join our Discord" link for a linked channel. Reuses an existing permanent
 * invite if the channel already has one (listing invites needs MANAGE_CHANNELS,
 * which the bot already holds) rather than minting a new code every time a
 * member opens the panel — Discord has no cap on invites, but there is no reason
 * to spray codes either. Falls back to creating one (max_age 0, max_uses 0 —
 * never expires, unlimited uses) when none exists.
 *
 * Requires CREATE_INSTANT_INVITE. A server that installed before this permission
 * was added will not have granted it — same retroactive-grant gap as every other
 * permission, surfaced by missingBotPermissions above. Returns null on any
 * failure; callers must render "no invite available", never a broken link.
 */
export async function createOrReuseChannelInvite(channelId: string): Promise<string | null> {
  if (!isBotConfigured()) return null

  const listRes = await fetch(`${DISCORD_BASE}/channels/${channelId}/invites`, {
    headers: botHeaders(),
  })
  if (listRes.ok) {
    const invites = (await listRes.json().catch(() => null)) as DiscordInvite[] | null
    const permanent = Array.isArray(invites)
      ? invites.find((i) => i.max_age === 0 && !i.temporary)
      : undefined
    if (permanent?.code) return `https://discord.gg/${permanent.code}`
  }

  const createRes = await fetch(`${DISCORD_BASE}/channels/${channelId}/invites`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ max_age: 0, max_uses: 0, temporary: false, unique: false }),
  })
  if (!createRes.ok) return null
  const created = (await createRes.json().catch(() => null)) as DiscordInvite | null
  return created?.code ? `https://discord.gg/${created.code}` : null
}
