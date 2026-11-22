/**
 * Survivor host lines in league chat, drawn as island cards (ChatMessageList).
 *
 * How a row is recognised, from what the client actually receives: the Survivor chat bridge
 * (lib/survivor/survivorChatBridge.ts) mirrors every engine post into `LeagueChatMessage` with
 * `metadata.survivorChat = { messageId, channelId, channelType, contentType, … }`, and a host/system
 * post additionally gets `metadata.chimmy = true`. Both read routes (`/api/league/chat` via
 * `/api/app/leagues/[id]/chat`, and `/api/shared/chat/threads/league:[id]/messages`) return the
 * stored metadata through `getLeagueChatMessages`, so both keys reach the browser.
 *
 * ⚠ BOTH KEYS ARE REQUIRED, AND BOTH ARE SERVER-OWNED. `chimmy` is in `CHIMMY_SERVER_KEYS` and the
 * client metadata allowlist (lib/chat-core/clientMessageInput.ts) never admits `survivorChat`, so a
 * member cannot dress their own message as the host. A human castaway's mirrored message carries
 * `survivorChat` but no `chimmy` marker, and stays an ordinary bubble.
 *
 * Styling only: nothing here changes who can post, what is stored or what a row offers.
 */

import { isChimmyAuthored } from '@/lib/league-chat/chimmyIdentity'

export type SurvivorHostCard = {
  /** The castaway seat Chimmy speaks for (bridge `castawayName`); null for a host announcement. */
  castawayName: string | null
  /** The engine row's content type (`host_announcement`, `text`, …), for styling hooks. */
  contentType: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function readSurvivorHostCard(metadata: unknown): SurvivorHostCard | null {
  if (!isChimmyAuthored(metadata)) return null
  const survivor = record(record(metadata)?.survivorChat)
  if (!survivor) return null
  const name = typeof survivor.castawayName === 'string' ? survivor.castawayName.trim() : ''
  const contentType = typeof survivor.contentType === 'string' && survivor.contentType ? survivor.contentType : 'text'
  return { castawayName: name ? name.slice(0, 60) : null, contentType }
}
