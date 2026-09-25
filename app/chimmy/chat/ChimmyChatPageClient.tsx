'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Eye, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ChimmyPanel, type CommsLeague } from '@/components/core-app/comms/ChimmyPanel'
import type { ChimmyPlanAllowanceView } from '@/lib/chimmy/planAllowanceView'
import { useVisibleViewportHeight } from '@/app/chimmy/hooks/useVisibleViewportHeight'
import {
  CHIMMY_PAGE_BACK_FALLBACK,
  CHIMMY_PAGE_SOURCE,
  initialChatScope,
  shouldGoBackInHistory,
} from '@/lib/chimmy/chatPage'
import './chimmy-page.css'

/**
 * `/chimmy/chat` — the chat drawer's Chimmy tab, full screen (owner's call, 2026-09-25: "the same
 * look and features as the chat drawer's Chimmy tab, just full-screen").
 *
 * ⚠ THE PANEL IS THE DRAWER'S OWN COMPONENT, NOT A LOOKALIKE. League picker, Fast/Deep, starter
 * questions and follow-ups, evidence / scenario / advice cards, confirm cards, the token price and
 * consent, thumbs, history restore — all of it is `ChimmyPanel`, so a fix to one surface is a fix to
 * both. This file adds only what a PAGE needs that a drawer does not: a way back, the URL's
 * question and league, and a height that follows the on-screen keyboard.
 *
 * What the old page carried and this one drops on purpose — the "AI Hub" / "AI Status" / wallet side
 * rail, the Chimmy-shortcuts popup, the assistant-mode grid and the sport + league selects — came from
 * the global app shell and the old `ChimmyChatShell`, not from anything the drawer has.
 */
export type ChimmyChatPageClientProps = {
  userId: string
  leagues: CommsLeague[]
  /** Tokens per Chimmy answer, from the pricing matrix — the same number the drawer quotes. */
  tokenCost: number | null
  /** Included answers left today when the plan includes Chimmy; null otherwise. */
  planAllowance?: ChimmyPlanAllowanceView | null
  /** `?prompt=` — typed into the box, never sent. */
  prompt?: string | null
  /** `?leagueId=` — the scope the chat opens in, when it is one of the viewer's leagues. */
  leagueId?: string | null
  /** `?sport=`, already validated — context for a question asked with no league in scope. */
  sport?: string | null
}

export function ChimmyChatPageClient(props: ChimmyChatPageClientProps) {
  const router = useRouter()
  const [scopeId, setScopeId] = useState<string | null>(() => initialChatScope(props.leagueId, props.leagues))
  const scopeName = props.leagues.find((l) => l.id === scopeId)?.name ?? null

  /*
   * Opening Chimmy is reading its weekly lineup and waiver checks: they stop counting toward the chat
   * bubble. Same call the drawer makes when its Chimmy tab opens.
   */
  useEffect(() => {
    void fetch('/api/chat/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'chimmy' }),
    }).catch(() => {})
  }, [])

  /*
   * 🛑 THE KEYBOARD DOES NOT SHRINK `100dvh`. The dynamic viewport units track browser chrome, not
   * the virtual keyboard — that is the viewport meta's `interactive-widget`, whose default is
   * `resizes-visual`. So the page takes the VISIBLE height while a keyboard covers part of it, and
   * the composer, which ends the column, sits right above the keys. `null` means "use the
   * stylesheet": with no keyboard, or no `visualViewport`, nothing inline is written.
   */
  const mainRef = useRef<HTMLElement | null>(null)
  const visibleHeight = useVisibleViewportHeight(mainRef)

  /*
   * "Back" is a link to /core that becomes a history step when the page behind this one is ours.
   * Modified clicks (new tab, new window) keep the plain link.
   */
  const onBack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    let documentUrl: string | null = null
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      documentUrl = nav?.name ?? null
    } catch {
      documentUrl = null
    }
    const goBack = shouldGoBackInHistory({
      documentUrl,
      currentPath: window.location.pathname,
      referrer: document.referrer,
      origin: window.location.origin,
      historyLength: window.history.length,
    })
    if (!goBack) return
    e.preventDefault()
    router.back()
  }

  return (
    <main
      ref={mainRef}
      className="af-cm af-chimmy-page"
      data-mode="page"
      data-keyboard-inset={visibleHeight === null ? undefined : 'open'}
      data-testid="chimmy-chat-page"
      style={visibleHeight === null ? undefined : { height: visibleHeight }}
    >
      <div className="af-chimmy-page-col">
        <header className="af-cm-head af-chimmy-page-head">
          <div className="af-cm-headtop">
            <Link
              href={CHIMMY_PAGE_BACK_FALLBACK}
              className="af-chimmy-page-back"
              onClick={onBack}
              data-testid="chimmy-chat-back-link"
            >
              <ChevronLeft size={18} aria-hidden />
              <span>Back</span>
            </Link>
            <span className="af-cm-brand">
              <Sparkles size={15} aria-hidden />
              <h1 className="af-cm-title">Chimmy</h1>
            </span>
            {/* Same contract as the drawer's header: the current scope is always on screen. */}
            <span className="af-cm-scopechip" data-global={scopeId == null}>
              {scopeName ?? 'GLOBAL'}
            </span>
          </div>
          <p className="af-cm-audience">
            <Eye size={12} aria-hidden />
            <span>Who sees this: Just you</span>
          </p>
        </header>

        {/*
          Private chat, like the drawer's Chimmy tab: no home signals (this page is not the /core
          home) and no Core screen to name. `source` keeps the name this page's questions have always
          been recorded under; `sport` is sent only while no league is in scope.
        */}
        <ChimmyPanel
          key={props.userId}
          leagues={props.leagues}
          scopeId={scopeId}
          onScope={setScopeId}
          tokenCost={props.tokenCost}
          planAllowance={props.planAllowance ?? null}
          publicMode={false}
          homeSignals={null}
          pageSurface={null}
          initialDraft={props.prompt ?? null}
          userId={props.userId}
          sport={props.sport ?? null}
          source={CHIMMY_PAGE_SOURCE}
        />
      </div>
    </main>
  )
}

export default ChimmyChatPageClient
