'use client'

import type { TeamScore, Driver } from '@/lib/rankings-engine/league-rankings-v2'

const DRIVER_LABELS: Record<string, string> = {
  record_surge: 'Win Streak',
  record_slide: 'Losing Streak',
  points_for_spike: 'Scoring Up',
  points_for_dip: 'Scoring Down',
  points_against_luck: 'Schedule Luck',
  luck_positive: 'Over-Performing',
  luck_negative: 'Under-Performing',
  power_strength_gain: 'Roster Rising',
  power_strength_drop: 'Roster Falling',
  depth_safety_gain: 'Bench Strength',
  depth_safety_drop: 'Bench Weakness',
  market_value_gain: 'Value Rising',
  market_value_drop: 'Value Falling',
  trade_edge_positive: 'Trade Winner',
  trade_edge_negative: 'Trade Losses',
  league_demand_tailwind: 'Market Tailwind',
  league_demand_headwind: 'Market Headwind',
}

export function WhatChangedPanel({ team }: { team: TeamScore }) {
  const delta = team.rankDelta
  if (delta === null || delta === 0) return null

  const moved = delta < 0 ? Math.abs(delta) : Math.abs(delta)
  const direction = delta < 0 ? 'up' : 'down'
  const arrow = delta < 0 ? '\u25B2' : '\u25BC'
  const color = delta < 0 ? 'text-emerald-400' : 'text-red-400'
  const borderColor = delta < 0 ? 'border-emerald-500/20' : 'border-red-500/20'
  const bgColor = delta < 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'

  const drivers = team.explanation?.drivers?.slice(0, 2) ?? []

  return (
    <div className={`rounded-lg border p-3 ${borderColor} ${bgColor}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">What Changed</span>
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`text-sm font-bold ${color}`}>{arrow} {moved}</span>
        <span className="text-xs text-white/50">rank{moved > 1 ? 's' : ''} {direction}</span>
      </div>
      {drivers.length > 0 && (
        <ul className="space-y-1">
          {drivers.map(d => (
            <li key={d.id} className="flex items-center gap-1.5 text-[11px]">
              <span className={d.polarity === 'UP' ? 'text-emerald-400' : d.polarity === 'DOWN' ? 'text-red-400' : 'text-white/30'}>
                {d.polarity === 'UP' ? '\u25B2' : d.polarity === 'DOWN' ? '\u25BC' : '\u25CF'}
              </span>
              <span className="text-white/60">{DRIVER_LABELS[d.id] || d.id}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function getTier(team: TeamScore): { label: string; color: string; description: string } {
  const ewins = team.expectedWins
  const marketAdj = team.marketAdj ?? 0
  const bbi = team.bounceBackIndex ?? 0
  const games = team.record.wins + team.record.losses + team.record.ties

  if (games < 3) {
    return { label: 'Too Early', color: 'text-white/40', description: 'Not enough games played' }
  }
  if (ewins >= 9 && marketAdj > 0) {
    return { label: 'Contender', color: 'text-emerald-400', description: 'Elite roster + winning pace' }
  }
  if (bbi >= 70 && team.luckDelta < -1) {
    return { label: 'Rising', color: 'text-amber-400', description: 'Talent exceeding record' }
  }
  if (marketAdj < -10) {
    return { label: 'Rebuilder', color: 'text-purple-400', description: 'Accumulating future value' }
  }
  if (ewins >= 7) {
    return { label: 'Playoff Threat', color: 'text-cyan-400', description: 'Competitive roster' }
  }
  return { label: 'Mid Pack', color: 'text-white/50', description: 'Average positioning' }
}

export function TierLabel({ team }: { team: TeamScore }) {
  const tier = getTier(team)

  return (
    <div className="flex items-center gap-2">
      <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
        tier.color === 'text-emerald-400' ? 'bg-emerald-500/10 border-emerald-500/20' :
        tier.color === 'text-amber-400' ? 'bg-amber-500/10 border-amber-500/20' :
        tier.color === 'text-purple-400' ? 'bg-purple-500/10 border-purple-500/20' :
        tier.color === 'text-cyan-400' ? 'bg-cyan-500/10 border-cyan-500/20' :
        'bg-white/5 border-white/10'
      } ${tier.color}`}>
        {tier.label}
      </span>
      <span className="text-[11px] text-white/30">{tier.description}</span>
    </div>
  )
}

function getWinWindow(team: TeamScore): { label: string; years: string; color: string; confidence: string } {
  const ewins = team.expectedWins
  const marketAdj = team.marketAdj ?? 0
  const mgrSkill = team.managerSkillScore
  const rosterExposure = team.rosterExposure ?? {}

  const pickExposure = rosterExposure['PICK'] ?? 0
  const hasPickHeavy = pickExposure > 0.25

  if (ewins >= 9 && marketAdj > 5 && mgrSkill >= 60) {
    return { label: 'Win Now', years: '1-2 years', color: 'text-emerald-400', confidence: 'High' }
  }
  if (ewins >= 7 && marketAdj >= 0) {
    return { label: 'Competitive', years: '1-3 years', color: 'text-cyan-400', confidence: 'Medium' }
  }
  if (hasPickHeavy && marketAdj < -5) {
    return { label: 'Rebuilding', years: '2-4 years', color: 'text-purple-400', confidence: 'Medium' }
  }
  if (ewins < 5 && marketAdj < 0) {
    return { label: 'Retooling', years: '1-2 years to compete', color: 'text-amber-400', confidence: 'Low' }
  }
  return { label: 'Flexible', years: 'Could pivot either way', color: 'text-white/50', confidence: 'Low' }
}

export function WinWindowPanel({ team }: { team: TeamScore }) {
  const window = getWinWindow(team)

  return (
    <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3">
      <div className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-2">Win Window</div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold ${window.color}`}>{window.label}</span>
        <span className="text-[11px] text-white/30">{window.years}</span>
      </div>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[11px] text-white/25">Confidence:</span>
        <span className={`text-[11px] font-medium ${
          window.confidence === 'High' ? 'text-emerald-400' :
          window.confidence === 'Medium' ? 'text-amber-400' : 'text-white/40'
        }`}>{window.confidence}</span>
      </div>
    </div>
  )
}
