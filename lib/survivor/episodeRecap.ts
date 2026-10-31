import 'server-only'

/**
 * "Episode recaps" for Survivor leagues: after each Tribal Council's elimination is final, Chimmy
 * writes the episode recap and posts it to league chat.
 *
 * ⚠ THE TOGGLE FOR THIS (`League.aiRecaps`) SAVED FOR MONTHS AND NOTHING READ IT; the old
 * lib/survivor/ai/storylineGenerator.ts was a stub nothing called. This is the reader.
 *
 * Paid and opt-in: the league turned "Episode recaps" on AND its owner holds AF Commissioner (the
 * plan the toggle is sold under). A free league already gets the Torch Ceremony post and the weekly
 * recap card, so it gets no extra post — and if the model is unavailable, nothing extra is posted
 * either: the ceremony post already said who left.
 *
 * PRIVATE BALLOTS STAY PRIVATE. The recap reads the public reveal (vote counts by TARGET, idols,
 * tiebreaks) — never `SurvivorVote`, so it can never say who voted for whom. It runs only after
 * `resolveElimination`, which itself refuses before the council read is complete, so it can never
 * name the voted-out manager early.
 *
 * Once per council (a double-elimination week has two): an audit marker `episode_recap_posted`, and
 * the chat row id is derived from the council id, so a retry finds its row.
 */
import { prisma } from '@/lib/prisma'
import { routeTextCall } from '@/lib/ai/providerRouter'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { upsertSurvivorChatMessage } from './survivorChatBridge'
import type { RevealScroll } from './survivorVoteTallyService'

export const EPISODE_RECAP_ACTION = 'episode_recap_posted'
/** Longest a council's finish waits for Chimmy. Past it, no recap — the ceremony post already ran. */
export const EPISODE_RECAP_TIMEOUT_MS = 15_000

export type SurvivorEpisodeFacts = {
  week: number
  councilNumber: number
  votedOut: string
  attendingTribe: string | null
  /** Counted votes by target, most first — targets only, never voters. */
  votes: Array<{ name: string; count: number }>
  idols: string[]
  tiebreak: string | null
  challengeWinner: string | null
  immunity: string | null
  /** Where the voted-out manager went: the jury, Exile Island, or home. */
  destination: 'jury' | 'exile' | 'out'
  remaining: number
}

const TIEBREAK_WORDS: Record<string, string> = {
  season_points_decided: 'a tie broken by finalized season points',
  stones_decided: 'a tie decided by drawing stones',
  rocks_decided: 'a tie decided by drawing rocks',
}

/** Pure: counted ballots by target, most votes first. Ballots that did not count are left out. */
export function countVotesByTarget(sequence: readonly RevealScroll[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const scroll of sequence) {
    if (scroll.status !== 'counts' || !scroll.targetName) continue
    counts.set(scroll.targetName, (counts.get(scroll.targetName) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Pure: the facts as the model sees them. */
export function episodeFactsForPrompt(f: SurvivorEpisodeFacts): string {
  return [
    `Week ${f.week}, Tribal Council ${f.councilNumber}`,
    f.attendingTribe ? `Tribe at Tribal Council: ${f.attendingTribe}` : null,
    f.challengeWinner ? `Immunity challenge won by: ${f.challengeWinner}` : null,
    f.immunity ? `Individual immunity: ${f.immunity}` : null,
    f.votes.length ? `Vote: ${f.votes.map((v) => `${v.count} for ${v.name}`).join(', ')}` : null,
    f.idols.length ? `Powers played: ${f.idols.join(', ')}` : null,
    f.tiebreak ? `Decided by: ${TIEBREAK_WORDS[f.tiebreak] ?? f.tiebreak}` : null,
    `Voted out: ${f.votedOut}`,
    f.destination === 'jury' ? `${f.votedOut} joins the jury.` : f.destination === 'exile' ? `${f.votedOut} is sent to Exile Island.` : null,
    `Managers remaining: ${f.remaining}`,
  ]
    .filter(Boolean)
    .join('\n')
}

const SYSTEM = `You are Chimmy, the host of an AllFantasy Survivor fantasy league. Write this week's episode recap for the league chat from the facts given.
- Use only the facts given. Use names exactly as written. Never invent votes, alliances or quotes.
- Never say who voted for whom; you only know how many votes each manager received.
- 90 to 150 words, plain prose, no headings, bullet points or hashtags.
- Dramatic, like a reality-TV narrator, never insulting or personal about the managers themselves.`

/** Chimmy's recap, or null when the model is unavailable, too slow, or does not name who left. Never throws. */
export async function writeEpisodeRecap(facts: SurvivorEpisodeFacts, opts: { userId: string; leagueId: string; timeoutMs?: number }): Promise<string | null> {
  const call = routeTextCall({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: episodeFactsForPrompt(facts) },
    ],
    maxTokens: 320,
    temperature: 0.7,
    profile: 'cheap',
    feature: 'survivor_episode_recap',
    userId: opts.userId,
    leagueId: opts.leagueId,
  }).catch(() => ({ ok: false as const }))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), opts.timeoutMs ?? EPISODE_RECAP_TIMEOUT_MS)
  })
  const result = await Promise.race([call, timeout])
  if (timer) clearTimeout(timer)
  // A cheap sanity check: the recap must name the manager who left.
  if (!result.ok || !result.text.trim() || !result.text.includes(facts.votedOut)) return null
  return `🔥 Episode recap · Week ${facts.week}\n${result.text.trim()}`
}

async function loadEpisodeFacts(leagueId: string, councilId: string, destination: SurvivorEpisodeFacts['destination']): Promise<SurvivorEpisodeFacts | null> {
  const council = await prisma.survivorTribalCouncil.findFirst({
    where: { id: councilId, leagueId },
    select: { week: true, councilNumber: true, eliminatedName: true, attendingTribeId: true, idolsPlayed: true, tiePhase: true, revealSequence: true },
  })
  if (!council?.eliminatedName) return null
  const [tribe, challenge, immune, remaining] = await Promise.all([
    council.attendingTribeId ? prisma.survivorTribe.findUnique({ where: { id: council.attendingTribeId }, select: { name: true } }) : null,
    prisma.survivorChallenge.findFirst({ where: { leagueId, week: council.week, status: 'complete' }, select: { winnerTribeId: true } }),
    prisma.survivorPlayer.findFirst({ where: { leagueId, hasImmunityThisWeek: true }, select: { displayName: true } }),
    prisma.survivorPlayer.count({ where: { leagueId, playerState: 'active' } }),
  ])
  const winner = challenge?.winnerTribeId ? await prisma.survivorTribe.findUnique({ where: { id: challenge.winnerTribeId }, select: { name: true } }) : null
  const idols = Array.isArray(council.idolsPlayed)
    ? (council.idolsPlayed as Array<{ powerLabel?: string }>).map((i) => i?.powerLabel ?? 'A hidden power')
    : []
  return {
    week: council.week,
    councilNumber: council.councilNumber,
    votedOut: council.eliminatedName,
    attendingTribe: tribe?.name ?? null,
    votes: countVotesByTarget(Array.isArray(council.revealSequence) ? (council.revealSequence as unknown as RevealScroll[]) : []),
    idols,
    tiebreak: council.tiePhase && TIEBREAK_WORDS[council.tiePhase] ? council.tiePhase : null,
    challengeWinner: winner?.name ?? null,
    immunity: immune?.displayName ?? null,
    destination,
    remaining,
  }
}

export type EpisodeRecapResult = 'posted' | 'off' | 'no_plan' | 'already_posted' | 'no_facts' | 'ai_unavailable' | 'no_channel'

/**
 * Called once a council's elimination is final (./survivorCouncilReadFinish.ts). Best-effort: the
 * caller must never let a failed recap fail an elimination.
 */
export async function postSurvivorEpisodeRecap(args: {
  leagueId: string
  councilId: string
  outcome: 'removed_to_waivers' | 'exile_island'
  write?: typeof writeEpisodeRecap
}): Promise<EpisodeRecapResult> {
  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { aiRecaps: true, userId: true } })
  if (!league?.aiRecaps) return 'off'
  if (!league.userId) return 'no_plan'
  const owner = await prisma.appUser.findUnique({ where: { id: league.userId }, select: { email: true, username: true } }).catch(() => null)
  if (!(await hasAfCommissionerPlan({ id: league.userId, email: owner?.email ?? null, username: owner?.username ?? null }))) return 'no_plan'

  const done = await prisma.survivorAuditEntry.findFirst({ where: { leagueId: args.leagueId, action: EPISODE_RECAP_ACTION, relatedEntityId: args.councilId }, select: { id: true } })
  if (done) return 'already_posted'

  // Joined the jury: the voted-out manager's own flag, which resolveElimination set in the same commit.
  const council = await prisma.survivorTribalCouncil.findFirst({ where: { id: args.councilId, leagueId: args.leagueId }, select: { eliminatedUserId: true } })
  const out = council?.eliminatedUserId
    ? await prisma.survivorPlayer.findFirst({ where: { leagueId: args.leagueId, userId: council.eliminatedUserId }, select: { isJuryMember: true } })
    : null
  const destination: SurvivorEpisodeFacts['destination'] = args.outcome === 'exile_island' ? 'exile' : out?.isJuryMember ? 'jury' : 'out'
  const facts = await loadEpisodeFacts(args.leagueId, args.councilId, destination)
  if (!facts) return 'no_facts'

  const channel = await prisma.survivorChatChannel.findFirst({ where: { leagueId: args.leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
  if (!channel) return 'no_channel'

  const text = await (args.write ?? writeEpisodeRecap)(facts, { userId: league.userId, leagueId: args.leagueId })
  if (!text) return 'ai_unavailable'

  const id = `survivor-episode-recap:${args.councilId}`
  await upsertSurvivorChatMessage(prisma, {
    where: { id },
    create: { id, leagueId: args.leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, contentType: 'host_announcement', content: text },
    update: {},
  })
  await prisma.survivorAuditEntry.create({
    data: { leagueId: args.leagueId, week: facts.week, category: 'tribal', action: EPISODE_RECAP_ACTION, relatedEntityId: args.councilId, relatedEntityType: 'council', data: { aiWritten: true }, isVisibleToCommissioner: true, isVisibleToPublic: false },
  })
  return 'posted'
}
