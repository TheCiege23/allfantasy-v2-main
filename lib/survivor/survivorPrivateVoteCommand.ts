import 'server-only'

import { loadCouncilContext } from './survivorCouncilService'
import { submitAdditionalIdolVote } from './survivorIdolResolutionService'
import { submitVote } from './survivorVoteService'

/** Commands are parsed by code, never by an LLM. Stable mentions disambiguate equal names. */
export function parsePrivateVoteMention(message: string): string | null {
  const match = message.trim().match(/^@chimmy\s+(?:(?:i\s+)?vote(?:\s+(?:out|for))?\s+)?(<@[A-Za-z0-9_-]+>|@[^\r\n]+)$/i)
  return match?.[1].trim() ?? null
}

export async function submitPrivateVoteCommand(leagueId: string, userId: string, message: string) {
  const additional = /^@chimmy\s+extra\s+vote\s+/i.test(message.trim())
  const mention = parsePrivateVoteMention(additional ? message.trim().replace(/^@chimmy\s+extra\s+vote\s+/i, '@Chimmy vote ') : message)
  if (!mention) return { ok: false as const, status: 422 as const, error: 'To vote, send @Chimmy @manager or @Chimmy vote @manager. Select a manager mention to avoid ambiguous names.' }
  const ctx = await loadCouncilContext(leagueId)
  if (!ctx) return { ok: false as const, status: 409 as const, error: 'No Elimination Council is open.' }
  const stableId = mention.match(/^<@([A-Za-z0-9_-]+)>$/)?.[1]
  const label = mention.replace(/^@/, '').toLocaleLowerCase('en-US')
  const matches = ctx.scopePlayers.filter(player => stableId ? player.userId === stableId : player.displayName.trim().toLocaleLowerCase('en-US') === label)
  if (matches.length !== 1) return { ok: false as const, status: 422 as const, error: 'That mention does not identify one eligible manager. Select the manager from the voting list.' }
  return additional ? submitAdditionalIdolVote(leagueId, userId, matches[0].userId) : submitVote(leagueId, userId, matches[0].userId)
}
