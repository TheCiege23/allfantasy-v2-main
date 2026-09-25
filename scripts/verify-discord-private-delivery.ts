import { config } from 'dotenv'
import { createLeagueChannel, fetchChannelMessages, getBotUserId, postMessage, privateChannelOverwrites } from '../lib/discord/bot'

config({ quiet: true })
config({ path: '.env.local', override: true, quiet: true })

async function main() {
  if (!process.argv.includes('--run-approved-test')) throw new Error('Explicit test flag required')
  const guildId = '1180313285313167390'
  const ownerId = '1085033561016516730'
  const name = 'af-certification-private'
  const headers = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
  const read = async (path: string) => {
    const response = await fetch(`https://discord.com/api/v10${path}`, { headers, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Discord read failed: ${response.status}`)
    return response.json()
  }
  const guild = await read(`/guilds/${guildId}`)
  if (guild.owner_id !== ownerId || guild.name !== "TheCiege1011's server") throw new Error('Approved server identity changed')
  const botId = await getBotUserId()
  if (!botId) throw new Error('Bot identity unavailable')
  const channels = await read(`/guilds/${guildId}/channels`) as Array<{ id: string; name: string }>
  const existing = channels.find(channel => channel.name === name)
  const channelId = existing?.id ?? (await createLeagueChannel(guildId, name, [ownerId])).channelId
  const channel = await read(`/channels/${channelId}`)
  const expected = privateChannelOverwrites(guildId, botId, [ownerId])
  const normalize = (rows: typeof expected) => rows.map(row => `${row.id}:${row.type}:${row.allow}:${row.deny}`).sort()
  if (JSON.stringify(normalize(channel.permission_overwrites)) !== JSON.stringify(normalize(expected))) throw new Error('Test channel permissions differ; no messages sent')
  const nonce = String(Date.now())
  const content = 'AllFantasy certification test: private bot delivery. No league activity or roster changes. This channel is restricted to the server owner and AllFantasy bot; Discord administrators retain access.'
  const first = await postMessage(channelId, content, undefined, nonce)
  const duplicate = await postMessage(channelId, content, undefined, nonce)
  if (first !== duplicate) throw new Error('Discord nonce deduplication failed')
  const form = new FormData()
  form.set('payload_json', JSON.stringify({ content: 'AllFantasy certification test attachment.', allowed_mentions: { parse: [] } }))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  form.set('files[0]', new Blob([png], { type: 'image/png' }), 'af-certification.png')
  const uploaded = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(15_000) })
  if (!uploaded.ok) throw new Error(`Discord attachment failed: ${uploaded.status}`)
  const attachmentMessage = await uploaded.json() as { id: string }
  const messages = await fetchChannelMessages(channelId, { limit: 10 })
  if (!messages.some(message => message.id === first) || !messages.some(message => message.id === attachmentMessage.id && message.attachments?.length)) throw new Error('Message or attachment missing on readback')
  console.log(JSON.stringify({ guildId, channelId, channelName: name, restrictedOverwritesVerified: true, messageReadback: true, attachmentReadback: true, nonceDeduplication: true, appBridgeCertified: false, messageIds: [first, attachmentMessage.id] }, null, 2))
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Certification failed'); process.exitCode = 1 })
