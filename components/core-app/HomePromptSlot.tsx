'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * One optional prompt at a time on the /core home.
 *
 * ⚠ UP TO FOUR STACKED BEFORE ANY CONTENT. The welcome tour, the game-day alerts banner, the
 * team-follow modal and the SMS opt-in card each decide on their own whether to show, so a
 * new user on a game day could get all four at once, above the sync panel and the home cards —
 * no single thing to do first, and the content pushed below the fold on a phone.
 *
 * Each prompt now asks for a turn with `useHomePromptTurn(id, wantsToShow)`. Of the prompts
 * that currently want to show, only the highest priority (lowest number in PRIORITY) renders.
 * When it is dismissed it stops wanting, releases the slot, and the next one gets its turn on
 * a later render — so nothing is lost, it is just queued.
 *
 * Outside a provider, or with `enabled` false (every screen but home), every prompt is granted:
 * the components stay usable anywhere exactly as before.
 *
 * Compliance and status surfaces (GeoRestrictionNotice, the sync panel) do NOT go through this.
 * They are not optional, and queueing them behind a marketing prompt would be wrong.
 */

/** Lower shows first. One-time orientation before recurring nudges. */
export const HOME_PROMPT_PRIORITY = {
  'welcome-tour': 1,
  'team-follow': 2,
  'game-day-alerts': 3,
  'sms-opt-in': 4,
} as const

export type HomePromptId = keyof typeof HOME_PROMPT_PRIORITY

type Slot = {
  enabled: boolean
  winner: HomePromptId | null
  setWants: (id: HomePromptId, wants: boolean) => void
}

const SlotContext = createContext<Slot | null>(null)

export function HomePromptSlot({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [wanting, setWanting] = useState<ReadonlySet<HomePromptId>>(() => new Set())

  const slot = useMemo<Slot>(() => {
    let winner: HomePromptId | null = null
    for (const id of wanting) {
      if (winner === null || HOME_PROMPT_PRIORITY[id] < HOME_PROMPT_PRIORITY[winner]) winner = id
    }
    return {
      enabled,
      winner,
      setWants: (id, wants) =>
        setWanting((prev) => {
          if (prev.has(id) === wants) return prev
          const next = new Set(prev)
          if (wants) next.add(id)
          else next.delete(id)
          return next
        }),
    }
  }, [enabled, wanting])

  return <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>
}

/**
 * Whether this prompt may render now. Pass the prompt's own "I would show" state; render only
 * when this returns true.
 *
 * Inside an enabled slot a prompt is never granted before its claim has registered, so the first
 * render (server and client alike) shows none of them — no hydration mismatch, and no flash of
 * several prompts collapsing to one.
 */
export function useHomePromptTurn(id: HomePromptId, wantsToShow: boolean): boolean {
  const slot = useContext(SlotContext)
  const setWants = slot?.setWants
  useEffect(() => {
    if (!setWants) return
    setWants(id, wantsToShow)
    return () => setWants(id, false)
    // `setWants` is recreated with the slot value; depending on it would re-run on every claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, wantsToShow, Boolean(setWants)])
  if (!slot || !slot.enabled) return wantsToShow
  return wantsToShow && slot.winner === id
}
