'use client'

import { useRef } from 'react'
import { MessageCircle, ChevronUp } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

import type { LeagueChatPreview } from '@/lib/core-app/leagueChatPreviewPick'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'

/**
 * League-first phone: the league's chat, one tap (or one swipe up) away, pinned above the tab bar.
 *
 * It replaces the floating chat bubble phase 1.5 hid. A bubble says "there is a chat somewhere";
 * this says what was last said in THIS league and who said it — the reason to open it.
 *
 * It opens the same drawer the bubble did, on the League tab, scoped to this league by id: the
 * drawer otherwise keeps whatever league it was last left on, and the bar names one league.
 * Phone only — hidden above 720px in af-core-shell.css, where the docked drawer already does this.
 */
export function LeagueChatBar({
  leagueId,
  leagueName,
  preview,
}: {
  leagueId: string
  leagueName: string | null
  preview: LeagueChatPreview | null
}) {
  const touchStartY = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const { language } = useOptionalLanguage()

  const open = () => {
    const detail: CommsOpenDetail = { tab: 'league', leagueId }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
  }

  return (
    <button
      type="button"
      className="af-lf-chatbar"
      aria-label={language === 'es' ? `Abrir chat de ${leagueName ?? 'la liga'}` : `Open ${leagueName ?? 'league'} chat`}
      onClick={() => {
        // iOS sends a click after touchend. A swipe must open the drawer once.
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        open()
      }}
      // A pull up opens it too — the gesture the bar's grip invites. A tap is still the main way in.
      onTouchStart={(e) => {
        touchStartY.current = e.touches[0]?.clientY ?? null
      }}
      onTouchEnd={(e) => {
        const start = touchStartY.current
        touchStartY.current = null
        const end = e.changedTouches[0]?.clientY
        if (start != null && end != null && start - end > 24) {
          suppressClick.current = true
          open()
          window.setTimeout(() => { suppressClick.current = false }, 450)
        }
      }}
    >
      <span className="af-lf-chatbar-grip" aria-hidden />
      <span className="af-lf-chatbar-icon" aria-hidden><MessageCircle size={21} strokeWidth={2.2} /></span>
      <span className="af-lf-chatbar-body">
        <span className="af-lf-chatbar-title">{coreUiCopy('League chat', language)}</span>
        <span className="af-lf-chatbar-preview">
          {preview ? (
            <>
              <strong>{preview.senderName}:</strong> {preview.text}
            </>
          ) : (
            coreUiCopy('No messages yet — say something to the league', language)
          )}
        </span>
      </span>
      <span className="af-lf-chatbar-chevron" aria-hidden><ChevronUp size={19} strokeWidth={2.4} /></span>
    </button>
  )
}
