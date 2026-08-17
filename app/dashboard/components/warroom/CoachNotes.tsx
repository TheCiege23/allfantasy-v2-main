'use client'

import { Sparkles } from 'lucide-react'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { PendingTradeLeague } from '@/app/dashboard/dashboardStripApiTypes'
import { WarRoomCard } from './WarRoomCard'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

const COACHING_REASON_TYPES = new Set(['ai_start_sit', 'ai_waiver', 'matchup_prep', 'injury_impact'])

type Note = { key: string; leagueName: string; message: string }

const MAX_NOTES = 4

/**
 * "This Week's Game Plan" — calm, plain-language commentary, deliberately not framed as AI/chat.
 * Reuses two sources already fetched for the dashboard rather than calling any new
 * recommendation engine: `LineupActionItem.message` (severity: 'info' only — anything
 * critical/warning is already surfaced by ActionCenter, so this stays non-duplicative
 * and keeps the calmer, non-urgent tone) and each pending trade's `chimmyReason`
 * (already Chimmy-voiced, never surfaced anywhere in the UI before this).
 */
export function CoachNotes({
  lineupActions,
  pendingTrades,
}: {
  lineupActions: LineupActionItem[]
  pendingTrades: PendingTradeLeague[]
}) {
  const { t } = useLanguage()

  const lineupNotes: Note[] = lineupActions
    .filter((a) => a.severity === 'info' && COACHING_REASON_TYPES.has(a.reasonType))
    .map((a) => ({
      key: `lineup-${a.leagueId}-${a.slotId ?? a.playerId ?? a.slotIndex}`,
      leagueName: a.leagueName,
      message: a.message,
    }))

  const tradeNotes: Note[] = pendingTrades.flatMap((league) =>
    league.trades
      // chimmyReason is empty when no AI verdict was computed (the home screen
      // no longer runs a per-trade model call). Skip those instead of emitting
      // a note with a blank message.
      .filter((trade) => Boolean(trade.chimmyReason))
      .map((trade) => ({
        key: `trade-${trade.transactionId}`,
        leagueName: league.leagueName,
        message: trade.chimmyReason,
      })),
  )

  const notes = [...lineupNotes, ...tradeNotes].slice(0, MAX_NOTES)

  if (notes.length === 0) return null

  return (
    <WarRoomCard className="overflow-hidden" accentBorder="rgba(52,211,153,0.18)">
      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300/80">
          <Sparkles className="h-3 w-3" aria-hidden />
          {t('dashboard.warroom.coachNotes.title')}
        </p>
      </div>
      <ul>
        {notes.map((note) => (
          <li key={note.key} className="border-b border-white/[0.04] px-4 py-2.5 last:border-b-0">
            <p className="text-[12px] leading-snug text-white/80">{note.message}</p>
            <p className="mt-0.5 truncate text-[10px] text-white/35">{note.leagueName}</p>
          </li>
        ))}
      </ul>
    </WarRoomCard>
  )
}
