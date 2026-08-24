/**
 * League chat @Chimmy routing for IDP leagues (AfSub-gated features).
 */

import { isIdpLeague } from '@/lib/idp'
import { prisma } from '@/lib/prisma'
import {
  getDefenderStartSitRec,
  getIDPWaiverTargets,
  getIDPMatchupAnalysis,
  getWeeklyIDPRankings,
  getSleeperDefenders,
  getSnapShareInsights,
  getIDPScarcityReport,
  generateIDPPowerRankings,
  getIdpChimmyHelpText,
  parseIdpPlayers,
} from '@/lib/idp/ai/idpChimmy'
import {
  getCapSpaceAdvice,
  getCapEfficiencyRankings,
  getCapBurdenWarnings,
  identifyTradeTargets,
  getContenderVsRebuildAdvice,
  generateDefenderWeeklyRecap,
  evaluateContractDecision,
  formatChatCapSummary,
  formatChatContractsList,
  formatChatCutPreview,
  formatChatExtendPreview,
  formatChatDefenseCapSimulate,
  getRedraftRosterIdForUser,
  getDefenderEvaluationForPlayer,
} from '@/lib/idp/ai/idpCapChimmy'
import { isCommissioner } from '@/lib/commissioner/permissions'

export type IdpLeagueChatProcessResult =
  | { outcome: 'post_user_only' }
  | { outcome: 'suppress_public'; privateNotice: string }
  | {
      outcome: 'post_user_and_chimmy'
      chimmyMessages: Array<{ text: string; metadata?: Record<string, unknown> }>
    }

function chimmyMeta(extra?: Record<string, unknown>): Record<string, unknown> {
  return { chimmy: true, idp: true, ...extra }
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

export async function processIdpLeagueChatInput(
  leagueId: string,
  userId: string,
  rawMessage: string
): Promise<IdpLeagueChatProcessResult | null> {
  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return null

  if (!rawMessage.toLowerCase().includes('@chimmy')) {
    return null
  }

  const rest = stripChimmy(rawMessage)
  const low = rest.toLowerCase()

  if (low.startsWith('help idp') || low.includes('help idp')) {
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [{ text: getIdpChimmyHelpText(), metadata: chimmyMeta({ idpCard: 'help' }) }],
    }
  }

  const weekMatch = rawMessage.match(/\b(?:week\s*)?(\d{1,2})\b/i)
  const week = weekMatch ? Math.min(18, Math.max(1, parseInt(weekMatch[1]!, 10))) : 1

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  const managerId = userId

  const privateNotice = (text: string) => ({
    outcome: 'suppress_public' as const,
    privateNotice: text,
  })

  try {
    // ── Cap / contract (public — no AfSub) ─────────────────────────────
    if (
      (low === 'cap' || /^cap\s*$/i.test(low.trim())) &&
      !low.includes('advice') &&
      !low.includes('efficiency') &&
      !low.includes('burden')
    ) {
      const text = await formatChatCapSummary(leagueId, userId)
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text, metadata: chimmyMeta({ idpAction: 'cap_summary' }) }],
      }
    }
    if (low.startsWith('contracts') || low === 'contracts') {
      const text = await formatChatContractsList(leagueId, userId)
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text, metadata: chimmyMeta({ idpAction: 'contracts_list' }) }],
      }
    }
    if (low.startsWith('simulate defense cap') || low.includes('simulate defense cap')) {
      const text = await formatChatDefenseCapSimulate(leagueId, userId)
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text, metadata: chimmyMeta({ idpAction: 'cap_sim' }) }],
      }
    }
    const cutM = low.match(/^cut\s+(.+)/)
    if (cutM?.[1]) {
      const text = await formatChatCutPreview(leagueId, userId, cutM[1].trim())
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text, metadata: chimmyMeta({ idpAction: 'cut_preview' }) }],
      }
    }
    const extM = low.match(/^extend\s+(.+)/)
    if (extM?.[1]) {
      const text = await formatChatExtendPreview(leagueId, userId, extM[1].trim())
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [{ text, metadata: chimmyMeta({ idpAction: 'extend_preview' }) }],
      }
    }

    // ── AfSub cap AI ────────────────────────────────────────────────────
    if (low.includes('cap advice')) {
      const rosterId = await getRedraftRosterIdForUser(leagueId, userId)
      if (!rosterId) return privateNotice('Could not resolve your redraft roster for cap.')
      try {
        const advice = await getCapSpaceAdvice(leagueId, rosterId)
        const lines = advice.recommendations
          .map((r) => `• ${r.action} → ${r.player ?? '—'} → ${r.savingsOrCost} — ${r.reason}`)
          .join('\n')
        return {
          outcome: 'suppress_public',
          privateNotice: `💡 **Cap advice (private)**\n${advice.summary}\n\n${lines}`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }
    if (low.includes('cap efficiency')) {
      try {
        const r = await getCapEfficiencyRankings(leagueId, week)
        const up = r.underpriced.map((x) => `${x.playerName}: ${x.ptsPerM.toFixed(2)} pts/$M`).join('\n')
        const down = r.overpriced.map((x) => `${x.playerName}: ${x.ptsPerM.toFixed(2)} pts/$M`).join('\n')
        return {
          outcome: 'suppress_public',
          privateNotice: `📊 **Cap efficiency — Week ${week}** (private)\nBest value:\n${up}\n\nWorst value:\n${down}\nLeague avg ${r.leagueAvgEfficiency.toFixed(3)} pts/$M`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }
    if (low.includes('cap burden')) {
      const rosterId = await getRedraftRosterIdForUser(leagueId, userId)
      if (!rosterId) return privateNotice('Could not resolve roster.')
      try {
        const w = await getCapBurdenWarnings(leagueId, rosterId)
        const text = w.map((x) => `• ${x.year}: ${x.message} — ${x.detail}`).join('\n') || 'No major burden flags.'
        return { outcome: 'suppress_public', privateNotice: `⚠️ **Cap burden** (private)\n${text}` }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }
    if (low.includes('trade targets cap') || (low.includes('trade') && low.includes('targets') && low.includes('cap'))) {
      try {
        const t = await identifyTradeTargets(leagueId, userId)
        return {
          outcome: 'suppress_public',
          privateNotice: `🎯 **Trade targets** (private)\n${t.summary}\n\n${t.targets
            .slice(0, 5)
            .map((x) => `• ${x.playerName} (${x.position}) $${x.salary}M — ${x.note}`)
            .join('\n')}`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }
    if (low.includes('contender rebuild')) {
      try {
        const a = await getContenderVsRebuildAdvice(leagueId, userId)
        return {
          outcome: 'suppress_public',
          privateNotice: `🏗️ **${a.mode}** (private)\n${a.reasoning}\n${a.recommendedActions.map((x) => `• ${x}`).join('\n')}`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }
    if (low.includes('weekly recap') || low.includes('defender recap')) {
      try {
        const r = await generateDefenderWeeklyRecap(leagueId, userId, week)
        return {
          outcome: 'suppress_public',
          privateNotice: `📝 **Week ${r.week} recap** (private)\n${r.text}`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }
    const defVal = low.match(/defender value\s+(.+)/)
    if (defVal?.[1]) {
      const nameQ = defVal[1].trim()
      const roster = await prisma.roster.findFirst({
        where: { leagueId, platformUserId: userId },
        select: { playerData: true },
      })
      const defs = parseIdpPlayers(roster?.playerData)
      const p = defs.find((d) => d.name.toLowerCase().includes(nameQ.toLowerCase()))
      if (!p) return privateNotice(`No defender match for "${nameQ}" on your roster snapshot.`)
      try {
        const { evaluation: ev } = await getDefenderEvaluationForPlayer(leagueId, userId, week, p.playerId)
        return {
          outcome: 'suppress_public',
          privateNotice: `🛡️ **${p.name}** eval (private)\nOverall ${ev.overallGrade.toFixed(1)} · Start ${ev.weeklyStartGrade} · ${ev.verdict}\n${ev.topReasons.join('\n')}`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }
    const ce = low.match(/contract eval\s+(.+?)\s+(cut|extend|tag|hold)\s*$/)
    if (ce?.[1] && ce[2]) {
      const rosterId = await getRedraftRosterIdForUser(leagueId, userId)
      if (!rosterId) return privateNotice('Could not resolve roster.')
      const nameQ = ce[1].trim()
      const rec = await prisma.iDPSalaryRecord.findFirst({
        where: {
          leagueId,
          rosterId,
          playerName: { contains: nameQ, mode: 'insensitive' },
        },
      })
      if (!rec) return privateNotice(`No contract for "${nameQ}".`)
      const dt = ce[2] === 'tag' ? 'tag' : ce[2] === 'cut' ? 'cut' : ce[2] === 'extend' ? 'extend' : 'hold'
      try {
        const out = await evaluateContractDecision(leagueId, rosterId, rec.playerId, dt)
        return {
          outcome: 'suppress_public',
          privateNotice: `📋 **Contract ${dt}** (private)\n${out.recommendation}\n${out.reasoning.join(' ')}`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('idp rankings') || low.startsWith('idp rankings')) {
      const pos = rest.match(/idp rankings\s+(\w+)/i)?.[1]
      try {
        const list = await getWeeklyIDPRankings(leagueId, week, pos)
        const lines = list.entries
          .slice(0, 8)
          .map((e) => `${e.rank}. ${e.name} (${e.position}, ${e.team ?? '—'}) — ${e.projectedPts} proj`)
          .join('\n')
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [
            {
              text: `🏈 Top IDP Rankings — Week ${week}:\n${lines}`,
              metadata: chimmyMeta({ idpAction: 'rankings' }),
            },
          ],
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('start sit defense') || (low.includes('start sit') && low.includes('defense'))) {
      if (!roster) return privateNotice('Could not resolve your roster.')
      try {
        const a = await getDefenderStartSitRec(leagueId, managerId, week)
        return {
          outcome: 'suppress_public',
          privateNotice: `🔒 Start/Sit (private)\n\nSTART: ${a.starters.join(', ')}\nSIT: ${a.sitters.join(', ')}\n\n${a.analysis}`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('waiver targets defense') || (low.includes('waiver') && low.includes('targets'))) {
      const lim = parseInt(rest.match(/(\d+)\s*$/)?.[1] ?? '5', 10) || 5
      try {
        const targets = await getIDPWaiverTargets(leagueId, week, Math.min(10, lim))
        const lines = targets.map((t) => `${t.rank}. ${t.name} (${t.position}, ${t.team ?? '—'}) — ${t.reasoning}`).join('\n')
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [{ text: `🏈 Top IDP Waiver Targets:\n${lines}`, metadata: chimmyMeta({ idpAction: 'waivers' }) }],
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('matchup analysis')) {
      if (!roster) return privateNotice('Could not resolve your roster.')
      try {
        const a = await getIDPMatchupAnalysis(leagueId, managerId, week)
        return {
          outcome: 'suppress_public',
          privateNotice: `🔒 Matchup analysis (private)\n\n${a.analysis}`,
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('snap analysis')) {
      if (!roster) return privateNotice('Could not resolve your roster.')
      try {
        const s = await getSnapShareInsights(leagueId, managerId)
        const text = [
          'Snap share snapshot:',
          ...s.concerns.map((c) => `⚠️ ${c.player}: ${c.snap_share}% (${c.trend}) — ${c.note}`),
          ...s.positives.map((c) => `✓ ${c.player}: ${c.snap_share}% (${c.trend}) — ${c.note}`),
          ...(s.note ? [s.note] : []),
        ].join('\n')
        return { outcome: 'suppress_public', privateNotice: `🔒 ${text}` }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('idp sleepers')) {
      try {
        const sl = await getSleeperDefenders(leagueId, week)
        const lines =
          sl.length > 0
            ? sl.map((x) => `• ${x.name} (${x.position}) — ${x.reasoning}`).join('\n')
            : 'No unrostered defenders with rising ingested production right now.'
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [{ text: `💎 IDP Sleepers:\n${lines}`, metadata: chimmyMeta({ idpAction: 'sleepers' }) }],
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('idp scarcity')) {
      try {
        const sc = await getIDPScarcityReport(leagueId, week)
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [
            {
              text: `📊 IDP Scarcity\n${sc.summary}\n${Object.entries(sc.byPosition)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}`,
              metadata: chimmyMeta({ idpAction: 'scarcity' }),
            },
          ],
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.includes('power rankings') && low.includes('idp')) {
      if (!(await isCommissioner(leagueId, userId))) {
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [{ text: '⚠️ Only the commissioner can generate IDP power rankings.', metadata: chimmyMeta() }],
        }
      }
      try {
        const pr = await generateIDPPowerRankings(leagueId, week)
        return {
          outcome: 'post_user_and_chimmy',
          chimmyMessages: [{ text: pr.fullText, metadata: chimmyMeta({ idpAction: 'power_rankings' }) }],
        }
      } catch (e) {
        const g = subGate(e)
        if (g) return privateNotice(g)
        throw e
      }
    }

    if (low.trim().startsWith('idp') || /\bidp\b/.test(low)) {
      return {
        outcome: 'post_user_and_chimmy',
        chimmyMessages: [
          {
            text: "🤖 Try `@chimmy help idp` for IDP commands (e.g. `@chimmy idp rankings`).",
            metadata: chimmyMeta(),
          },
        ],
      }
    }
  } catch (e) {
    return {
      outcome: 'post_user_and_chimmy',
      chimmyMessages: [
        {
          text: `⚠️ ${e instanceof Error ? e.message : 'IDP Chimmy error'}`,
          metadata: chimmyMeta({ error: true }),
        },
      ],
    }
  }

  return null
}
