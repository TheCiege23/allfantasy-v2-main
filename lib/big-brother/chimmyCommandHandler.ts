/**
 * Big Brother league @Chimmy command handling for league chat and Chimmy API.
 */

import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { isBigBrotherLeague } from './BigBrotherLeagueConfig'
import { getCurrentCycleForLeague, transitionPhase } from './BigBrotherPhaseStateMachine'
import { getEligibility, isJuryRoster } from './BigBrotherEligibilityEngine'
import { setNominations, setReplacementNominee } from './BigBrotherNominationEngine'
import { applyBigBrotherVeto } from './BigBrotherVetoEngine'
import { getRosterDisplayNamesForLeague } from './ai/getRosterDisplayNames'
import { announceNominationCeremony } from './BigBrotherChatAnnouncements'
import { buildBigBrotherAIContext } from './ai/BigBrotherAIContext'
import { generateBigBrotherAI } from './ai/BigBrotherAIService'
import { isFinaleReached } from './BigBrotherFinaleService'
import { pullMinigame } from './BigBrotherMinigameRegistry'
import type { BigBrotherWeekPhase } from './types'

export const BB_RULES_GLOSSARY: Record<string, string> = {
  hoh: 'The Head of Household wins a competition each week (or is assigned by your league rules). The HOH is safe from eviction and chooses two houseguests to nominate for eviction.',
  nominations:
    'The HOH nominates two managers for eviction. Those players are “on the block.” Later, veto may remove one; if so, the HOH names a replacement.',
  veto: 'The Power of Veto lets the veto winner remove a nominee from the block. If used, the HOH must name a replacement. If not used, nominations stay the same.',
  block: '“On the block” means nominated for eviction that week. The house votes privately to evict one of the final nominees.',
  jury: 'Evicted managers can join the jury (per your league settings). The jury votes privately at the finale to crown the winner.',
  finals: 'The final two (or three) managers face the jury. Jury members cast private votes; the engine tallies and announces the winner.',
  eviction: 'Each eviction cycle, eligible voters cast private votes. The player with the most votes against them is evicted unless a tie-break rule applies.',
  tiebreak:
    'If votes tie, your league’s tie-break mode applies (for example: HOH break, season points, random, or commissioner decision).',
  pov: 'POV (Power of Veto) is the same as the veto: one competition winner can save a nominee or let nominations stand.',
  replacement:
    'After a veto removes someone from the block, the HOH names a single replacement nominee who takes that spot before the live vote.',
  vote: 'Eviction votes are private. Cast them in the Vote Center or in private @Chimmy — public chat votes do not count.',
}

export type BbLeagueChatProcessResult =
  | { outcome: 'post_user_only' }
  | { outcome: 'suppress_public'; privateNotice: string }
  | {
      outcome: 'post_user_and_chimmy'
      chimmyMessages: Array<{ text: string; metadata?: Record<string, unknown> }>
    }

function chimmyMeta(extra?: Record<string, unknown>): Record<string, unknown> {
  return { chimmy: true, bigBrother: true, ...extra }
}

export async function logBigBrotherChatCommand(args: {
  leagueId: string
  userId: string
  cycleId?: string | null
  rawMessage: string
  isValid: boolean
  errorMessage?: string | null
  commandType?: string | null
}): Promise<void> {
  await prisma.bigBrotherChatCommandLog.create({
    data: {
      leagueId: args.leagueId,
      userId: args.userId,
      cycleId: args.cycleId ?? null,
      rawMessage: args.rawMessage,
      isValid: args.isValid,
      errorMessage: args.errorMessage ?? null,
      commandType: args.commandType ?? null,
    },
  })
}

/** Broad detection of eviction vote language in public league chat (must stay private). */
export function looksLikePublicEvictionVote(raw: string): boolean {
  const t = raw.trim().toLowerCase()
  if (t.includes('@chimmy explain')) return false
  if (t.startsWith('@chimmy') && /\bvote\b/.test(t)) return true
  if (/^i\s+vote\s+for\b/.test(t)) return true
  if (/^vote\s+to\s+evict\b/.test(t)) return true
  if (/^my\s+vote\s+is\b/.test(t)) return true
  if (/\bvote\s+for\s+\w+/.test(t) && !t.includes('@chimmy explain')) return true
  return false
}

function stripChimmyPrefix(raw: string): string {
  const lower = raw.toLowerCase()
  const idx = lower.indexOf('@chimmy')
  if (idx < 0) return raw.trim()
  return raw.slice(idx + '@chimmy'.length).trim()
}

function findRosterIdByName(fragment: string, names: Record<string, string>): string | null {
  const q = fragment.trim().toLowerCase()
  if (!q) return null
  let best: { id: string; score: number } | null = null
  for (const [id, display] of Object.entries(names)) {
    const d = display.toLowerCase()
    if (d === q) return id
    if (d.includes(q) && q.length >= 2) {
      const score = q.length / d.length
      if (!best || score > best.score) best = { id, score }
    }
  }
  return best?.id ?? null
}

function parseNameTokensAfterCommand(rest: string, cmd: string): string[] {
  const low = rest.toLowerCase()
  const prefix = cmd.toLowerCase()
  let tail = low.startsWith(prefix) ? rest.slice(cmd.length).trim() : rest
  if (cmd === 'jury vote') {
    tail = tail.replace(/^jury\s+vote\s*/i, '').trim()
  } else {
    tail = tail.replace(new RegExp(`^${prefix.replace(/\s+/g, '\\s+')}\\s*`, 'i'), '').trim()
  }
  if (!tail) return []
  return tail.split(/\s+/).filter(Boolean)
}

async function handleExplain(leagueId: string, termRaw: string, userId: string): Promise<string> {
  const term = termRaw.trim().toLowerCase()
  const keys = Object.keys(BB_RULES_GLOSSARY)
  const direct = keys.find((k) => k === term || term.includes(k) || k.includes(term))
  if (direct && BB_RULES_GLOSSARY[direct]) {
    return `📖 **${direct}**\n${BB_RULES_GLOSSARY[direct]}`
  }
  const ctx = await buildBigBrotherAIContext(leagueId, 'chimmy_host')
  if (!ctx) return `📖 I couldn’t load league context. Try: ${keys.slice(0, 6).join(', ')}.`
  try {
    const aiCtx = { ...ctx, explainTerm: termRaw.trim() || 'Big Brother rules' }
    const { narrative } = await generateBigBrotherAI(aiCtx, 'rule_explain', userId)
    return `📖 ${narrative}`
  } catch {
    return `📖 “${termRaw}”: In Big Brother fantasy leagues, rules follow your commissioner’s settings — check the ceremony center and deadlines for what applies this week.`
  }
}

async function buildStatusText(leagueId: string, cycleId: string): Promise<string> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: {
      week: true,
      phase: true,
      hohRosterId: true,
      nominee1RosterId: true,
      nominee2RosterId: true,
      vetoWinnerRosterId: true,
      vetoUsed: true,
      voteDeadlineAt: true,
    },
  })
  if (!cycle) return '🏠 Chimmy: No active cycle.'
  const ids = [
    cycle.hohRosterId,
    cycle.nominee1RosterId,
    cycle.nominee2RosterId,
    cycle.vetoWinnerRosterId,
  ].filter(Boolean) as string[]
  const names = ids.length ? await getRosterDisplayNamesForLeague(leagueId, ids) : {}
  const line = (k: string, id: string | null) =>
    id ? `${k}: ${names[id] ?? id.slice(0, 8)}` : `${k}: —`
  return [
    `🏠 **House status (Week ${cycle.week})**`,
    `Phase: ${cycle.phase}`,
    line('HOH', cycle.hohRosterId),
    line('Nom 1', cycle.nominee1RosterId),
    line('Nom 2', cycle.nominee2RosterId),
    line('Veto winner', cycle.vetoWinnerRosterId),
    `Veto used: ${cycle.vetoUsed ? 'yes' : 'no'}`,
    cycle.voteDeadlineAt ? `Vote deadline: ${cycle.voteDeadlineAt.toISOString()}` : 'Vote deadline: —',
  ].join('\n')
}

async function buildDeadlinesText(leagueId: string): Promise<string> {
  const config = await prisma.bigBrotherLeagueConfig.findUnique({
    where: { leagueId },
    select: {
      nominationDeadlineDayOfWeek: true,
      nominationDeadlineTimeUtc: true,
      vetoDecisionDeadlineDayOfWeek: true,
      vetoDecisionDeadlineTimeUtc: true,
      replacementNomineeDeadlineDayOfWeek: true,
      replacementNomineeDeadlineTimeUtc: true,
      evictionVoteCloseDayOfWeek: true,
      evictionVoteCloseTimeUtc: true,
    },
  })
  if (!config) return '⏳ Deadlines: config not found.'
  const rows: string[] = ['⏳ **Configured windows (UTC labels from league settings)**']
  if (config.nominationDeadlineDayOfWeek != null) {
    rows.push(`• Nominations: DOW ${config.nominationDeadlineDayOfWeek} @ ${config.nominationDeadlineTimeUtc ?? '—'}`)
  }
  if (config.vetoDecisionDeadlineDayOfWeek != null) {
    rows.push(`• Veto decision: DOW ${config.vetoDecisionDeadlineDayOfWeek} @ ${config.vetoDecisionDeadlineTimeUtc ?? '—'}`)
  }
  if (config.replacementNomineeDeadlineDayOfWeek != null) {
    rows.push(`• Replacement: DOW ${config.replacementNomineeDeadlineDayOfWeek} @ ${config.replacementNomineeDeadlineTimeUtc ?? '—'}`)
  }
  if (config.evictionVoteCloseDayOfWeek != null) {
    rows.push(`• Eviction vote closes: DOW ${config.evictionVoteCloseDayOfWeek} @ ${config.evictionVoteCloseTimeUtc ?? '—'}`)
  }
  return rows.join('\n')
}

/**
 * Process a league chat line for Big Brother leagues. Caller checks `isBigBrotherLeague` first.
 */
export async function processBigBrotherLeagueChatInput(
  leagueId: string,
  userId: string,
  rawMessage: string
): Promise<BbLeagueChatProcessResult> {
  const current = await getCurrentCycleForLeague(leagueId)
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  const myRosterId = roster?.id ?? await acceptedCoOwnerRosterId(leagueId, userId)

  if (looksLikePublicEvictionVote(rawMessage)) {
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current?.id,
      rawMessage,
      isValid: false,
      errorMessage: 'attempted_public_vote',
      commandType: 'public_vote_block',
    })
    return {
      outcome: 'suppress_public',
      privateNotice:
        '🔒 Votes must be private. Tap the Vote Center or message me directly — your public message won’t count.',
    }
  }

  if (!rawMessage.toLowerCase().includes('@chimmy')) {
    return { outcome: 'post_user_only' }
  }

  const rest = stripChimmyPrefix(rawMessage)
  const lower = rest.toLowerCase()
  if (!lower.trim()) {
    return { outcome: 'post_user_only' }
  }

  if (lower.startsWith('vote')) {
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current?.id,
      rawMessage,
      isValid: false,
      errorMessage: 'vote_redirect',
      commandType: 'vote_redirect',
    })
    return {
      outcome: 'suppress_public',
      privateNotice: '🔒 Vote privately in the Vote Center or DM @Chimmy — public votes don’t count.',
    }
  }

  if (lower.startsWith('jury') && lower.includes('vote')) {
    const finale = await isFinaleReached(leagueId)
    const juryOk = myRosterId ? await isJuryRoster(leagueId, myRosterId) : false
    if (!finale || !juryOk) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current?.id,
        rawMessage,
        isValid: false,
        errorMessage: 'jury_vote_private_only',
        commandType: 'jury_vote',
      })
      return {
        outcome: 'suppress_public',
        privateNotice: '⚖️ Jury votes are private. Open your @Chimmy tab or Jury Center to cast a finale vote.',
      }
    }
  }

  if (lower.startsWith('status')) {
    const text = current ? await buildStatusText(leagueId, current.id) : '🏠 No active cycle.'
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current?.id,
      rawMessage,
      isValid: true,
      commandType: 'status',
    })
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [{ text, metadata: chimmyMeta({ bbCard: 'status' }) }],
    }
  }

  if (lower.startsWith('deadlines')) {
    const text = await buildDeadlinesText(leagueId)
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current?.id,
      rawMessage,
      isValid: true,
      commandType: 'deadlines',
    })
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [{ text, metadata: chimmyMeta({ bbCard: 'deadlines' }) }],
    }
  }

  if (lower.startsWith('explain')) {
    const term = rest.replace(/^explain\s+/i, '').trim() || 'rules'
    const text = await handleExplain(leagueId, term, userId)
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current?.id,
      rawMessage,
      isValid: true,
      commandType: 'explain',
    })
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [{ text, metadata: chimmyMeta({ bbCard: 'explain' }) }],
    }
  }

  if (lower.startsWith('minigame') || lower.startsWith('mini game') || lower.startsWith('challenge')) {
    if (!current) {
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: '🎮 No active cycle to pull a minigame for.', metadata: chimmyMeta() }],
      }
    }
    const phase = current.phase as BigBrotherWeekPhase
    const kind: 'hoh' | 'veto' =
      phase === 'VETO_DRAW' || phase === 'VETO_CHALLENGE_OPEN' ? 'veto' : 'hoh'
    const mg = pullMinigame(leagueId, current.week, kind)
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current.id,
      rawMessage,
      isValid: true,
      commandType: 'minigame',
    })
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [
        {
          text: `🎮 **${kind === 'hoh' ? 'HOH' : 'POV'} minigame (Week ${current.week}): ${mg.title}**\n${mg.prompt}\n\n_Outcome is decided by scoring — this prompt themes the competition._`,
          metadata: chimmyMeta({ bbCard: 'minigame', minigameId: mg.id, kind }),
        },
      ],
    }
  }

  if (lower.startsWith('help')) {
    const text = [
      '🤖 **@Chimmy help (Big Brother)**',
      '• `@chimmy status` — house snapshot',
      '• `@chimmy deadlines` — configured windows',
      '• `@chimmy minigame` — themed HOH/POV minigame for this week',
      '• `@chimmy explain [term]` — rules glossary / AI',
      '• Actions (role + phase): nominate, replacement, veto, vote (private only)',
      '• Eviction votes are always private — use Vote Center or DM Chimmy.',
    ].join('\n')
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current?.id,
      rawMessage,
      isValid: true,
      commandType: 'help',
    })
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [{ text, metadata: chimmyMeta({ bbCard: 'help' }) }],
    }
  }

  if (lower.startsWith('nominate') && current) {
    const phase = current.phase as BigBrotherWeekPhase
    if (phase !== 'NOMINATION_OPEN' || !myRosterId || !current.id) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: 'wrong_phase_or_role',
        commandType: 'nominate',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [
          { text: '⚠️ Nominations aren’t open for you right now, or you’re not the HOH.', metadata: chimmyMeta() },
        ],
      }
    }
    const cycleRow = await prisma.bigBrotherCycle.findUnique({
      where: { id: current.id },
      select: { hohRosterId: true },
    })
    if (cycleRow?.hohRosterId !== myRosterId) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: 'not_hoh',
        commandType: 'nominate',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: '⚠️ Only the HOH can nominate.', metadata: chimmyMeta() }],
      }
    }
    const after = rest.replace(/^nominate\s+/i, '').trim()
    const parts = after.split(/\s+/).filter(Boolean)
    const names = await getRosterDisplayNamesForLeague(leagueId)
    const r1 = parts[0] ? findRosterIdByName(parts[0], names) : null
    const r2 = parts.length > 1 ? findRosterIdByName(parts.slice(1).join(' '), names) : null
    const a = r1
    const b = r2
    if (!a || !b || a === b) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: 'bad_nominee_names',
        commandType: 'nominate',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [
          { text: '⚠️ Use: `@chimmy nominate [name1] [name2]` with two eligible managers.', metadata: chimmyMeta() },
        ],
      }
    }
    const nom = await setNominations(current.id, a, b)
    if (!nom.ok) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: nom.error ?? 'nom_failed',
        commandType: 'nominate',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: `⚠️ ${nom.error ?? 'Could not set nominations.'}`, metadata: chimmyMeta() }],
      }
    }
    await transitionPhase(current.id, 'NOMINATION_LOCKED')
    const dn = await getRosterDisplayNamesForLeague(leagueId, [a, b])
    await announceNominationCeremony({
      leagueId,
      week: current.week,
      nominee1RosterId: a,
      nominee2RosterId: b,
      name1: dn[a],
      name2: dn[b],
    })
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current.id,
      rawMessage,
      isValid: true,
      commandType: 'nominate',
    })
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [
        {
          text: `✓ ${dn[a] ?? 'Nominee 1'} and ${dn[b] ?? 'Nominee 2'} nominated.`,
          metadata: chimmyMeta({ bbCard: 'nom_confirm' }),
        },
      ],
    }
  }

  if (lower.startsWith('replacement') && current) {
    const phase = current.phase as BigBrotherWeekPhase
    if (phase !== 'REPLACEMENT_NOMINATION_OPEN' || !myRosterId) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: 'wrong_phase',
        commandType: 'replacement',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: '⚠️ Replacement nomination is not open.', metadata: chimmyMeta() }],
      }
    }
    const cycleRow = await prisma.bigBrotherCycle.findUnique({
      where: { id: current.id },
      select: { hohRosterId: true },
    })
    if (cycleRow?.hohRosterId !== myRosterId) {
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: '⚠️ Only the HOH picks the replacement.', metadata: chimmyMeta() }],
      }
    }
    const tokens = parseNameTokensAfterCommand(rest, 'replacement')
    const names = await getRosterDisplayNamesForLeague(leagueId)
    const rep = tokens.length ? findRosterIdByName(tokens.join(' '), names) : null
    if (!rep) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: 'bad_name',
        commandType: 'replacement',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: '⚠️ Use: `@chimmy replacement [name]`', metadata: chimmyMeta() }],
      }
    }
    const res = await setReplacementNominee(current.id, rep)
    if (!res.ok) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: res.error ?? 'replacement_failed',
        commandType: 'replacement',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: `⚠️ ${res.error ?? 'Invalid replacement.'}`, metadata: chimmyMeta() }],
      }
    }
    await transitionPhase(current.id, 'VOTING_OPEN')
    const dn = await getRosterDisplayNamesForLeague(leagueId, [rep])
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current.id,
      rawMessage,
      isValid: true,
      commandType: 'replacement',
    })
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [
        { text: `✓ Replacement set: ${dn[rep] ?? rep}. Voting is open.`, metadata: chimmyMeta({ bbCard: 'replacement' }) },
      ],
    }
  }

  if ((lower.startsWith('veto') || lower.startsWith('pov')) && current) {
    const phase = current.phase as BigBrotherWeekPhase
    if (phase !== 'VETO_DECISION_OPEN' || !myRosterId) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: 'wrong_phase',
        commandType: 'veto',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: '⚠️ Veto decision is not open.', metadata: chimmyMeta() }],
      }
    }
    const cycleRow = await prisma.bigBrotherCycle.findUnique({
      where: { id: current.id },
      select: { vetoWinnerRosterId: true },
    })
    if (cycleRow?.vetoWinnerRosterId !== myRosterId) {
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: '⚠️ Only the veto winner can use this command.', metadata: chimmyMeta() }],
      }
    }
    if (lower.includes('pass')) {
      await transitionPhase(current.id, 'VOTING_OPEN')
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: true,
        commandType: 'veto_pass',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [
          { text: '✓ Veto unused — nominations stand. Voting opens.', metadata: chimmyMeta({ bbCard: 'veto_pass' }) },
        ],
      }
    }
    const useMatch = rest.match(/(?:use|save)\s+(.+)/i)
    const frag = useMatch?.[1]?.trim() ?? ''
    const names = await getRosterDisplayNamesForLeague(leagueId)
    const saved = frag ? findRosterIdByName(frag, names) : null
    if (!saved) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: 'bad_nominee',
        commandType: 'veto_use',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: '⚠️ Use: `@chimmy veto use [nominee name]` or `@chimmy veto pass`', metadata: chimmyMeta() }],
      }
    }
    const vu = await applyBigBrotherVeto(current.id, saved)
    if (!vu.ok) {
      await logBigBrotherChatCommand({
        leagueId,
        userId,
        cycleId: current.id,
        rawMessage,
        isValid: false,
        errorMessage: vu.error ?? 'veto_failed',
        commandType: 'veto_use',
      })
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: `⚠️ ${vu.error ?? 'Could not use veto.'}`, metadata: chimmyMeta() }],
      }
    }
    await transitionPhase(current.id, 'REPLACEMENT_NOMINATION_OPEN')
    await logBigBrotherChatCommand({
      leagueId,
      userId,
      cycleId: current.id,
      rawMessage,
      isValid: true,
      commandType: 'veto_use',
    })
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [
        { text: '✓ Veto used — HOH must name a replacement nominee.', metadata: chimmyMeta({ bbCard: 'veto_use' }) },
      ],
    }
  }

  await logBigBrotherChatCommand({
    leagueId,
    userId,
    cycleId: current?.id,
    rawMessage,
    isValid: false,
    errorMessage: 'unrecognized',
    commandType: 'unknown',
  })
  return {
    outcome: 'post_user_and_chimmy',
    chimmyMessages: [
      {
        text: "🤖 I didn’t catch that BB command. Try `@chimmy help` or `@chimmy status`.",
        metadata: chimmyMeta(),
      },
    ],
  }
}

export type BbChimmyAutocompleteCtx = {
  phase: string
  myRosterId: string | null
  hohRosterId: string | null
  vetoWinnerRosterId: string | null
  nominee1RosterId: string | null
  nominee2RosterId: string | null
  vetoParticipantRosterIds: string[] | null
  canVote: string[]
  juryRosterIds: string[]
  isJury: boolean
  finaleActive: boolean
}

export function getBbChimmyCommandSuggestions(ctx: BbChimmyAutocompleteCtx): string[] {
  const base = ['@chimmy status', '@chimmy deadlines', '@chimmy minigame', '@chimmy explain [rule]', '@chimmy help']
  const { phase, myRosterId, hohRosterId, vetoWinnerRosterId, canVote, isJury, finaleActive } = ctx
  const isHoh = myRosterId && hohRosterId === myRosterId
  const isVetoWinner = myRosterId && vetoWinnerRosterId === myRosterId
  const isVoter = myRosterId && canVote.includes(myRosterId)

  if (phase === 'NOMINATION_OPEN' && isHoh) {
    return ['@chimmy nominate [name1] [name2]', ...base]
  }
  if (phase === 'REPLACEMENT_NOMINATION_OPEN' && isHoh) {
    return ['@chimmy replacement [name]', ...base]
  }
  if (phase === 'VETO_DECISION_OPEN' && isVetoWinner) {
    return ['@chimmy veto use [nominee_name]', '@chimmy veto pass', '@chimmy status', '@chimmy deadlines']
  }
  if (phase === 'VOTING_OPEN' && isVoter) {
    return ['@chimmy vote [nominee]  ← Vote privately below ↓', ...base]
  }
  if (finaleActive && isJury) {
    return ['@chimmy jury vote [finalist]', ...base]
  }
  return base
}

/**
 * For autocomplete dropdown after partial command: eligible manager names etc.
 */
export async function getBbChimmyMentionOptions(args: {
  leagueId: string
  draft: string
  userId: string
}): Promise<{ type: 'command' | 'manager' | 'nominee' | 'redirect'; options: string[] }> {
  const { leagueId, draft, userId } = args
  const low = draft.toLowerCase()
  if (!low.includes('@chimmy')) return { type: 'command', options: [] }

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  const myRosterId = roster?.id ?? await acceptedCoOwnerRosterId(leagueId, userId)

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return { type: 'command', options: getBbChimmyCommandSuggestions({ phase: '—', myRosterId, hohRosterId: null, vetoWinnerRosterId: null, nominee1RosterId: null, nominee2RosterId: null, vetoParticipantRosterIds: null, canVote: [], juryRosterIds: [], isJury: false, finaleActive: false }) }

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: current.id },
    select: {
      phase: true,
      hohRosterId: true,
      nominee1RosterId: true,
      nominee2RosterId: true,
      vetoWinnerRosterId: true,
      vetoParticipantRosterIds: true,
    },
  })
  const eligibility = await getEligibility(leagueId, { cycleId: current.id })
  const config = await prisma.bigBrotherLeagueConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  const jury = config
    ? await prisma.bigBrotherJuryMember.findMany({ where: { leagueId }, select: { rosterId: true } })
    : []
  const juryIds = jury.map((j) => j.rosterId)
  const finaleActive = await isFinaleReached(leagueId)
  const isJury = myRosterId ? juryIds.includes(myRosterId) : false

  const ctx: BbChimmyAutocompleteCtx = {
    phase: cycle?.phase ?? '—',
    myRosterId,
    hohRosterId: cycle?.hohRosterId ?? null,
    vetoWinnerRosterId: cycle?.vetoWinnerRosterId ?? null,
    nominee1RosterId: cycle?.nominee1RosterId ?? null,
    nominee2RosterId: cycle?.nominee2RosterId ?? null,
    vetoParticipantRosterIds: (cycle?.vetoParticipantRosterIds as string[] | null) ?? null,
    canVote: eligibility?.canVote ?? [],
    juryRosterIds: juryIds,
    isJury,
    finaleActive,
  }

  if (/@chimmy\s+vote\s*$/i.test(draft) || /@chimmy\s+vote\s+\S*$/i.test(draft)) {
    return {
      type: 'redirect',
      options: ['Vote privately below ↓ (public chat does not count)'],
    }
  }

  const afterNom = low.match(/@chimmy\s+nominate\s+(.*)$/)
  if (afterNom && cycle?.phase === 'NOMINATION_OPEN' && myRosterId === cycle.hohRosterId) {
    const elig = eligibility?.canBeNominated ?? []
    const names = await getRosterDisplayNamesForLeague(leagueId, elig.length ? elig : undefined)
    return { type: 'manager', options: elig.map((id) => names[id] ?? id).filter(Boolean) }
  }

  const afterRep = low.match(/@chimmy\s+replacement\s+(.*)$/)
  if (afterRep && cycle?.phase === 'REPLACEMENT_NOMINATION_OPEN' && myRosterId === cycle.hohRosterId) {
    const participants = new Set((cycle.vetoParticipantRosterIds as string[] | null) ?? [])
    const eliminated = new Set(eligibility?.eliminatedRosterIds ?? [])
    const all = await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })
    const pool = all
      .map((r) => r.id)
      .filter((id) => !eliminated.has(id) && !participants.has(id) && id !== cycle.hohRosterId)
    const names = await getRosterDisplayNamesForLeague(leagueId, pool)
    return { type: 'manager', options: pool.map((id) => names[id] ?? id) }
  }

  const afterVetoUse = low.match(/@chimmy\s+veto\s+use\s+(.*)$/)
  if (afterVetoUse && cycle?.phase === 'VETO_DECISION_OPEN') {
    const n1 = cycle.nominee1RosterId
    const n2 = cycle.nominee2RosterId
    const ids = [n1, n2].filter(Boolean) as string[]
    const names = await getRosterDisplayNamesForLeague(leagueId, ids)
    return { type: 'nominee', options: ids.map((id) => names[id] ?? id) }
  }

  return { type: 'command', options: getBbChimmyCommandSuggestions(ctx) }
}
