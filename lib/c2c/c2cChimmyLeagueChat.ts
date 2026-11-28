/**
 * League chat @chimmy routing for C2C leagues (free info + AfSub-gated AI).
 */

import { prisma } from '@/lib/prisma'
import { c2cScoreModeDescription } from '@/lib/c2c/c2cUiLabels'
import { loadC2CLeagueSettings } from '@/lib/c2c/c2cLeagueSettings'
import {
  evaluateCampusPlayer,
  getCampusRankings,
  getC2CChimmyHelpText,
  getCantonRankings,
  getTransitionWatchForManager,
} from '@/lib/c2c/ai/c2cChimmy'

export type C2cLeagueChatProcessResult =
  | { outcome: 'post_user_only' }
  | { outcome: 'suppress_public'; privateNotice: string }
  | {
      outcome: 'post_user_and_chimmy'
      chimmyMessages: Array<{ text: string; metadata?: Record<string, unknown> }>
    }

function chimmyMeta(extra?: Record<string, unknown>): Record<string, unknown> {
  return { chimmy: true, c2c: true, ...extra }
}

function stripChimmy(raw: string): string {
  const lower = raw.toLowerCase()
  const idx = lower.indexOf('@chimmy')
  if (idx < 0) return raw.trim()
  return raw.slice(idx + '@chimmy'.length).trim()
}

function subGate(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('Commissioner Subscription')) {
    return '🔒 This feature requires the AF Commissioner Subscription.'
  }
  return null
}

async function getUserRedraftRosterId(leagueId: string, userId: string): Promise<string | null> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true },
  })
  if (!season) return null
  const roster = await prisma.redraftRoster.findFirst({
    where: { seasonId: season.id, ownerId: userId },
    select: { id: true },
  })
  return roster?.id ?? null
}

export async function processC2cLeagueChatInput(
  leagueId: string,
  userId: string,
  rawMessage: string,
): Promise<C2cLeagueChatProcessResult | null> {
  const cfg = await loadC2CLeagueSettings(leagueId)
  if (!cfg) return null

  if (!rawMessage.toLowerCase().includes('@chimmy')) {
    return null
  }

  const rest = stripChimmy(rawMessage)
  const low = rest.toLowerCase()

  const privateNotice = (text: string) => ({
    outcome: 'suppress_public' as const,
    privateNotice: text,
  })


  try {
    if (low.trim() === 'help' || (low.includes('help') && !low.includes('evaluate'))) {
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text: getC2CChimmyHelpText(), metadata: chimmyMeta({ c2cCard: 'help' }) }],
      }
    }

    if (low.includes('c2c rules')) {
      if (!cfg) {
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [{ text: '📘 C2C: configure Campus 2 Canton in commissioner settings.', metadata: chimmyMeta() }],
        }
      }
      const text = [
        '📘 **Campus 2 Canton (C2C) rules (summary)**',
        `• **Sport pair:** ${cfg.sportPair}`,
        `• **Scoring mode:** ${cfg.scoringMode} — ${c2cScoreModeDescription({
          sportPair: cfg.sportPair,
          scoringMode: cfg.scoringMode,
          campusScoreWeight: cfg.campusScoreWeight,
          cantonScoreWeight: cfg.cantonScoreWeight,
        })}`,
        `• **Starters:** campus ${cfg.campusStarterSlots} · canton ${cfg.cantonStarterSlots}`,
        `• **Bench / taxi / devy / IR:** ${cfg.benchSlots} / ${cfg.taxiSlots} / ${cfg.devySlots} / ${cfg.irSlots}`,
        `• **Devy scoring:** ${cfg.devyScoringEnabled ? 'on' : 'off (stash-only rights)'}`,
      ].join('\n')
      return { outcome: 'post_user_and_chimmy', chimmyMessages: [{ text, metadata: chimmyMeta({ c2cCard: 'rules' }) }] }
    }

    if (low.includes('scoring mode')) {
      if (!cfg) {
        return { outcome: 'post_user_and_chimmy', chimmyMessages: [{ text: 'Scoring: no C2C row found.', metadata: chimmyMeta() }] }
      }
      const desc = c2cScoreModeDescription({
        sportPair: cfg.sportPair,
        scoringMode: cfg.scoringMode,
        campusScoreWeight: cfg.campusScoreWeight,
        cantonScoreWeight: cfg.cantonScoreWeight,
      })
      const w =
        cfg.scoringMode === 'weighted_combined'
          ? `Campus weight **${Math.round(cfg.campusScoreWeight * 100)}%** · Canton **${Math.round(cfg.cantonScoreWeight * 100)}%**`
          : ''
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [
          {
            text: `📊 **Scoring:** ${cfg.scoringMode}\n${desc}${w ? `\n${w}` : ''}`,
            metadata: chimmyMeta({ c2cCard: 'scoring' }),
          },
        ],
      }
    }

    if (low.includes('taxi rules')) {
      if (!cfg) {
        return { outcome: 'post_user_and_chimmy', chimmyMessages: [{ text: '🚕 Taxi: no C2C config.', metadata: chimmyMeta() }] }
      }
      const lock = cfg.taxiLockDeadline ? new Date(cfg.taxiLockDeadline).toLocaleString() : 'not set'
      const text = [
        '🚕 **Taxi (C2C)**',
        `• Slots: **${cfg.taxiSlots}**`,
        `• Rookie-only: **${cfg.taxiRookieOnly ? 'yes' : 'no'}**`,
        `• Max experience years: **${cfg.taxiMaxExperienceYears}**`,
        `• Lock deadline: **${lock}**`,
      ].join('\n')
      return { outcome: 'post_user_and_chimmy', chimmyMessages: [{ text, metadata: chimmyMeta({ c2cCard: 'taxi' }) }] }
    }

    if (low.includes('devy rules')) {
      if (!cfg) {
        return { outcome: 'post_user_and_chimmy', chimmyMessages: [{ text: 'Devy: no C2C config.', metadata: chimmyMeta() }] }
      }
      const text = [
        '🎓 **Devy (C2C)**',
        `• Devy slots: **${cfg.devySlots}**`,
        `• Scoring while in devy bucket: **${cfg.devyScoringEnabled ? 'yes (campus-eligible rules apply)' : 'no — stash rights only'}**`,
      ].join('\n')
      return { outcome: 'post_user_and_chimmy', chimmyMessages: [{ text, metadata: chimmyMeta({ c2cCard: 'devy' }) }] }
    }

    if (low.includes('draft format')) {
      if (!cfg) {
        return { outcome: 'post_user_and_chimmy', chimmyMessages: [{ text: '📋 Draft format: no C2C config.', metadata: chimmyMeta() }] }
      }
      const text = `📋 **Draft format**\n• Startup: **${cfg.startupDraftFormat}**\n• Future: **${cfg.futureDraftFormat}**`
      return { outcome: 'post_user_and_chimmy', chimmyMessages: [{ text, metadata: chimmyMeta({ c2cCard: 'drafts' }) }] }
    }

    if (low.includes('transition watch')) {
      try {
        const txt = await getTransitionWatchForManager(leagueId, userId)
        return privateNotice(txt)
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('campus rankings')) {
      const posMatch = rest.match(/campus rankings\s+(\S+)/i)
      const position = posMatch?.[1] && posMatch[1].toLowerCase() !== 'campus' ? posMatch[1] : undefined
      try {
        const list = await getCampusRankings(leagueId, position)
        const lines = list
          .slice(0, 20)
          .map((e) => `${e.rank}. ${e.name} (${e.position}) — ${e.note}`)
          .join('\n')
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [
            {
              text: `🎓 Campus rankings${position ? ` (${position})` : ''}:\n${lines}`,
              metadata: chimmyMeta({ c2cAction: 'campus_rankings' }),
            },
          ],
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('pro rankings')) {
      const posMatch = rest.match(/pro rankings\s+(\S+)/i)
      const position = posMatch?.[1] && posMatch[1].toLowerCase() !== 'pro' ? posMatch[1] : undefined
      try {
        const list = await getCantonRankings(leagueId, position)
        const lines = list
          .slice(0, 20)
          .map((e) => `${e.rank}. ${e.name} (${e.position}) — ${e.note}`)
          .join('\n')
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [
            {
              text: `🏙 Canton rankings${position ? ` (${position})` : ''}:\n${lines}`,
              metadata: chimmyMeta({ c2cAction: 'pro_rankings' }),
            },
          ],
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('evaluate prospect') || /^evaluate\s+\S+/i.test(rest.trim())) {
      const rosterId = await getUserRedraftRosterId(leagueId, userId)
      if (!rosterId) return privateNotice('Could not resolve your roster.')
      const namePart = rest.replace(/^\s*evaluate\s+prospect\s*/i, '').replace(/^\s*evaluate\s+/i, '').trim()
      if (!namePart) {
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [{ text: 'Usage: `@chimmy evaluate prospect <name>` (AfSub).', metadata: chimmyMeta() }],
        }
      }
      const slot = await prisma.c2CPlayerState.findFirst({
        where: {
          leagueId,
          rosterId,
          playerSide: 'campus',
          playerName: { contains: namePart.slice(0, 48), mode: 'insensitive' },
        },
      })
      if (!slot) {
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [{ text: `No campus player matched “${namePart}”.`, metadata: chimmyMeta() }],
        }
      }
      try {
        const ev = await evaluateCampusPlayer(leagueId, userId, slot.playerId)
        const text = [
          `🔎 **${slot.playerName}** (${slot.position})`,
          `**Campus grade:** ${ev.campusGrade}`,
          `**Canton projection:** ${ev.cantonProjection}`,
          `**Start rec:** ${ev.startRec}`,
          `**Declaration risk:** ${ev.declarationRisk}`,
          `**Hold:** ${ev.holdRecommendation}`,
          `**Verdict:** ${ev.verdict}`,
        ].join('\n')
        return privateNotice(`🔒 Prospect eval (private)\n\n${text}`)
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [
        {
          text: '🤖 Try `@chimmy help` for C2C commands (`c2c rules`, `scoring mode`, `taxi rules`, …).',
          metadata: chimmyMeta(),
        },
      ],
    }
  } catch (e) {
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [
        {
          text: `⚠️ ${e instanceof Error ? e.message : 'C2C Chimmy error'}`,
          metadata: chimmyMeta({ error: true }),
        },
      ],
    }
  }
}
