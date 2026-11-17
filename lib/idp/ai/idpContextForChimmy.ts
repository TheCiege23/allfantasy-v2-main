/**
 * Build IDP league context for Chimmy when user is in an IDP league.
 * Deterministic data only. Chimmy never decides lineup, eligibility, scoring, or trade legality.
 */

import { isIdpLeague, getIdpLeagueConfig, getRosterDefaultsForIdpLeague } from '@/lib/idp'
import { IDP_SCORING_PRESET_LABELS, IDP_POSITION_MODE_LABELS } from '@/lib/idp/IDPScoringPresets'
import { prisma } from '@/lib/prisma'

export async function buildIdpContextForChimmy(
  leagueId: string,
  userId: string
): Promise<string> {
  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return ''

  const [config, defaults, roster] = await Promise.all([
    getIdpLeagueConfig(leagueId),
    getRosterDefaultsForIdpLeague(leagueId),
    (prisma as any).roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true, playerData: true },
    }),
  ])
  if (!config) return ''

  const scoringLabel = IDP_SCORING_PRESET_LABELS[config.scoringPreset] ?? config.scoringPreset
  const positionLabel = IDP_POSITION_MODE_LABELS[config.positionMode] ?? config.positionMode
  const idpSlots: string[] = []
  if (defaults?.starter_slots) {
    for (const [k, v] of Object.entries(defaults.starter_slots)) {
      if (typeof v === 'number' && v > 0 && !['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].includes(k)) {
        idpSlots.push(`${k}: ${v}`)
      }
    }
  }

  const parts: string[] = [
    '[IDP LEAGUE CONTEXT - for explanation only; you never decide lineup legality, eligibility, scoring, waiver processing, or trade legality]',
    `League ${leagueId} is an IDP league. Scoring: ${scoringLabel}. Position mode: ${positionLabel}.`,
    `IDP starter slots: ${idpSlots.length ? idpSlots.join(', ') : 'from league config'}. Best ball: ${config.bestBallEnabled}.`,
  ]

  if (roster?.playerData && Array.isArray(roster.playerData)) {
    const idpCount = roster.playerData.filter((p: any) => {
      const pos = (p?.position ?? p?.pos ?? '').toUpperCase()
      return ['DE', 'DT', 'LB', 'CB', 'S', 'SS', 'FS'].includes(pos)
    }).length
    parts.push(`User's roster in this league: ${roster.playerData.length} players, ${idpCount} IDP-eligible.`)
  }

  parts.push(
    'When the user asks about IDP: roster requirements, scoring settings, grouped vs split positions, waiver/trade implications, or best-ball implications — explain using this context. You can answer: why is this LB ranked so high, should I start this CB or safety, do I need more DL depth, is this trade fair in my scoring format, why did my best ball lineup choose this defender. Always recommend using Trade Analyzer, Waiver Chimmy, or league tools for actual decisions. Do not decide outcomes.'
  )
  return parts.join(' ')
}
