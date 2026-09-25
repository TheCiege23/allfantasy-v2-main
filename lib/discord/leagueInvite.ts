import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DISCORD_INVITE_SETTINGS_KEY, normalizeDiscordInviteUrl, storedDiscordInvite } from '@/lib/discord/inviteLink'

/**
 * The league's Discord invite, kept in `League.settings.discordInviteUrl` — no schema change.
 *
 * 🛑 DB-FIRST, AND THAT IS THE WHOLE POINT OF STORING IT. Members read the invite from Postgres on
 * every `/core/discord` and every drawer open. Nothing on a member's request asks Discord for one:
 * `GET /api/discord/league` used to call `createOrReuseChannelInvite` — a list, and on a miss a
 * CREATE — every time anyone opened the Discord tab. The only writers are the commissioner's own
 * actions: pasting a link (PATCH), and making the league channel (channels/create), which already
 * asks Discord for an invite and now keeps the answer instead of throwing it away.
 *
 * Who may write is not decided here — callers check `canManageDiscordBridge` first.
 */

type Settings = Record<string, unknown>

/**
 * Set only on an invite AllFantasy kept from channel creation: which channel it came from. A pasted
 * link never carries it. That is how a new league channel (the old one was deleted in Discord, or
 * the league moved server) knows the stored link is its predecessor's — dead with that channel —
 * rather than one the commissioner chose.
 */
const ADOPTED_FROM_KEY = 'discordInviteChannelId'

function asSettings(value: unknown): Settings {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Settings) } : {}
}

async function readSettings(leagueId: string): Promise<Settings> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return asSettings(league?.settings)
}

/** The invite members may use, or null when none is stored (or what is stored is not an invite). */
export async function readLeagueDiscordInvite(leagueId: string): Promise<string | null> {
  return storedDiscordInvite(await readSettings(leagueId))
}

/**
 * Store an already-validated invite, or remove it with null. Every other settings key is kept.
 *
 * ⚠ READ-MERGE-WRITE, the same shape `CommissionerSettingsService.updateLeagueSettings` uses for
 * this column. A concurrent settings save between the read and the write can lose one side; that is
 * the existing contract for `League.settings`, not a new one, and a commissioner saving a link is
 * a rare, deliberate action.
 */
export async function writeLeagueDiscordInvite(leagueId: string, inviteUrl: string | null): Promise<void> {
  const settings = await readSettings(leagueId)
  if (inviteUrl) settings[DISCORD_INVITE_SETTINGS_KEY] = inviteUrl
  else delete settings[DISCORD_INVITE_SETTINGS_KEY]
  // The commissioner chose this one (or chose none), so it is theirs from now on.
  delete settings[ADOPTED_FROM_KEY]
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: settings as Prisma.InputJsonValue },
  })
}

/**
 * After the league channel is made: keep the invite Discord just gave us, unless the commissioner
 * already chose one. Returns the invite members will actually see.
 *
 * ⚠ A PASTED LINK ALWAYS WINS. The commissioner may have pointed members at a welcome channel or a
 * vanity URL on purpose; making a channel must not quietly replace it.
 *
 * ⚠ AN INVITE KEPT FROM A DIFFERENT CHANNEL DOES NOT. Discord deletes a channel's invites with the
 * channel, so the link kept from a predecessor is dead (or points at the server the league left).
 * It is replaced — or removed, when Discord gave no new one — so members are never sent to a dead
 * link by something AllFantasy stored.
 */
export async function adoptLeagueDiscordInvite(
  leagueId: string,
  minted: string | null,
  channelId: string,
): Promise<string | null> {
  const settings = await readSettings(leagueId)
  const existing = storedDiscordInvite(settings)
  const adoptedFrom = typeof settings[ADOPTED_FROM_KEY] === 'string' ? settings[ADOPTED_FROM_KEY] : null
  if (existing && (adoptedFrom === null || adoptedFrom === channelId)) return existing

  const invite = normalizeDiscordInviteUrl(minted)
  if (!invite && !existing) return null
  if (invite) {
    settings[DISCORD_INVITE_SETTINGS_KEY] = invite
    settings[ADOPTED_FROM_KEY] = channelId
  } else {
    delete settings[DISCORD_INVITE_SETTINGS_KEY]
    delete settings[ADOPTED_FROM_KEY]
  }
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: settings as Prisma.InputJsonValue },
  })
  return invite
}
