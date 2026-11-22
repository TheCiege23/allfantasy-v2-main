'use client'

import { ArrowRight, AlertTriangle } from 'lucide-react'
import type { AIAction } from '@/lib/chimmy-actions'

interface ChimmyWorkflowPreviewCardProps {
  action: AIAction
  className?: string
}

/**
 * Shows a concise preview of what will happen when an AI action is executed.
 * Displayed inside ChimmyActionConfirmModal before the user confirms.
 */
export function ChimmyWorkflowPreviewCard({ action, className = '' }: ChimmyWorkflowPreviewCardProps) {
  const data = action.prefillData ?? {}
  const rows = buildPreviewRows(action, data)

  if (rows.length === 0) {
    return (
      <div
        className={[
          'rounded-xl border border-white/10 bg-white/5 px-4 py-3',
          className,
        ].join(' ')}
      >
        <p className="text-xs text-white/50">{action.description}</p>
      </div>
    )
  }

  return (
    <div
      className={[
        'rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5',
        className,
      ].join(' ')}
    >
      {rows.map(({ label, value, isWarning }) => (
        <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-xs text-white/50">{label}</span>
          <span
            className={[
              'flex items-center gap-1 text-xs font-medium',
              isWarning ? 'text-yellow-300' : 'text-white',
            ].join(' ')}
          >
            {isWarning && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />}
            {value}
          </span>
        </div>
      ))}

      {action.isDestructive && (
        <div className="flex items-center gap-2 px-4 py-2.5">
          <AlertTriangle className="h-3 w-3 shrink-0 text-yellow-400" aria-hidden="true" />
          <span className="text-xs text-yellow-300">This cannot be undone</span>
        </div>
      )}

      {action.prefillTarget && (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <span className="text-xs text-white/30">Opens</span>
          <span className="flex items-center gap-1 text-xs text-indigo-400">
            {formatTargetLabel(action.prefillTarget)}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Row Builders ───────────────────────────────────────────────────────────────

interface PreviewRow {
  label: string
  value: string
  isWarning?: boolean
}

function buildPreviewRows(
  action: AIAction,
  data: Record<string, unknown>,
): PreviewRow[] {
  const rows: PreviewRow[] = []

  const type = action.type

  // Player info
  const playerName = (data.playerName ?? (data.playerNames as string[] | undefined)?.[0]) as string | undefined
  if (playerName) {
    rows.push({ label: 'Player', value: playerName })
  }

  const playerIds = data.playerIds as string[] | undefined
  if (!playerName && playerIds && playerIds.length > 0) {
    rows.push({ label: 'Players', value: `${playerIds.length} selected` })
  }

  // Bid amount
  const bidAmount = data.suggestedBid ?? data.bidAmount
  if (bidAmount != null) {
    rows.push({ label: 'Bid', value: `$${bidAmount}` })
  }

  // Drop + Claim
  const dropPlayerName = data.dropPlayerName as string | undefined
  if (dropPlayerName) {
    rows.push({ label: 'Drop', value: dropPlayerName, isWarning: true })
  }

  // Slot
  const slot = data.slot ?? data.targetSlot
  if (slot) {
    rows.push({ label: 'Slot', value: String(slot) })
  }

  // Swap
  const playerInId = data.playerInId as string | undefined
  const playerOutId = data.playerOutId as string | undefined
  if (playerInId && playerOutId) {
    rows.push({ label: 'Swap', value: `IN ↔ OUT` })
  }

  // Trade assets
  const giving = data.givingAssets as string[] | undefined
  const receiving = data.receivingAssets as string[] | undefined
  if (giving && giving.length > 0) {
    rows.push({ label: 'You give', value: giving.join(', ') })
  }
  if (receiving && receiving.length > 0) {
    rows.push({ label: 'You get', value: receiving.join(', ') })
  }

  // Target team
  const targetTeam = data.targetTeamId as string | undefined
  if (targetTeam) {
    rows.push({ label: 'Target team', value: targetTeam })
  }

  // Optimization mode
  if (['optimize_ceiling', 'optimize_floor', 'optimize_categories'].includes(type)) {
    const modeMap: Record<string, string> = {
      optimize_ceiling: 'Max ceiling',
      optimize_floor: 'Max floor',
      optimize_categories: 'Category targeting',
    }
    rows.push({ label: 'Mode', value: modeMap[type] ?? type })
  }

  // Commissioner actions
  const draftText = data.draftText as string | undefined
  if (draftText) {
    rows.push({ label: 'Message', value: truncate(draftText, 60) })
  }

  // League
  if (action.leagueId) {
    rows.push({ label: 'League', value: action.leagueId })
  }

  return rows
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str
}

function formatTargetLabel(target: string): string {
  const labels: Record<string, string> = {
    draft_queue: 'Draft Queue',
    waiver_claim_modal: 'Waiver Claim',
    faab_bid_modal: 'FAAB Bidder',
    lineup_editor: 'Lineup Editor',
    trade_composer: 'Trade Composer',
    trade_analyzer_modal: 'Trade Analyzer',
    drop_confirm_modal: 'Drop Confirmation',
    roster_move_modal: 'Roster Move',
    matchup_simulator: 'Matchup Simulator',
    deep_dive_modal: 'Chimmy Deep Dive',
    announcement_composer: 'Announcement',
    chimmy_chat: 'Chimmy Chat',
    league_chat_composer: 'League Chat',
    league_join_flow: 'Join League',
    saved_recommendations: 'Saved',
    player_compare_modal: 'Compare',
  }
  return labels[target] ?? target.replace(/_/g, ' ')
}
