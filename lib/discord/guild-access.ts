import { prisma } from '@/lib/prisma'

const BASE = 'https://discord.com/api/v10'

/** Verify the connected human's server authority, not merely the bot's presence. */
export async function verifyGuildManager(userId: string, guildId: string): Promise<{ discordUserId: string; guildName: string } | null> {
  if (!/^\d{17,20}$/.test(guildId) || !process.env.DISCORD_BOT_TOKEN) return null
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { discordUserId: true, discordConnectedAt: true } })
  if (!profile?.discordUserId || !profile.discordConnectedAt) return null
  const headers = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
  const read = async (path: string) => {
    const response = await fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(10_000), cache: 'no-store' })
    if (!response.ok) throw new Error('Discord authority unavailable')
    return response.json()
  }
  try {
    const guild = await read(`/guilds/${guildId}`) as { owner_id?: string; name?: string }
    if (guild.owner_id === profile.discordUserId) return { discordUserId: profile.discordUserId, guildName: guild.name || 'Discord server' }
    const member = await read(`/guilds/${guildId}/members/${profile.discordUserId}`) as { roles?: string[] }
    const roles = await read(`/guilds/${guildId}/roles`) as Array<{ id: string; permissions: string }>
    const held = new Set([guildId, ...(member.roles ?? [])])
    let permissions = 0n
    for (const role of roles) if (held.has(role.id)) permissions |= BigInt(role.permissions)
    if ((permissions & (8n | 32n)) === 0n) return null
    return { discordUserId: profile.discordUserId, guildName: guild.name || 'Discord server' }
  } catch {
    return null
  }
}

/** Do not transfer server ownership on a repeated installation or a guessed ID. */
export async function linkVerifiedGuild(userId: string, guildId: string, guildName: string) {
  const row = await prisma.discordGuildLink.upsert({
    where: { guildId }, create: { guildId, guildName, linkedByUserId: userId }, update: {},
  })
  return row.linkedByUserId === userId
}
