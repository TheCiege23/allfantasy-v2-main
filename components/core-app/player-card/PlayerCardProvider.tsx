'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { PlayerCardData } from '@/lib/core-app/playerCard'
import PlayerCardSheet from './PlayerCardSheet'
import '@/components/core-app/af-player-card.css'

/**
 * The player card pop-up's mount point and its only opener.
 *
 * Every player name in `/core` opens the SAME sheet through this context, which
 * is the reason it is a provider rather than per-screen local state: the design
 * has one card opening from a dozen surfaces (my team, matchup, waivers, trades,
 * draft, live), and a per-surface copy would mean a dozen fetch/close/escape
 * implementations drifting apart.
 *
 * ⚠ THE OPENER TAKES A NAME AND A POSITION IT DOES NOT NEED. That is deliberate:
 * the sheet paints the header from them IMMEDIATELY and fills the rest when the
 * fetch lands. The caller always already has them — it just rendered the row —
 * so the card never opens as an empty box with a spinner where the player's
 * name should be.
 */

export type PlayerCardRef = {
  sport: string
  /** `SportsPlayer.externalId` — unique only WITHIN a sport, hence `sport` above. */
  externalId?: string | null
  sleeperId?: string | null
  /** Painted instantly, before the fetch resolves. */
  name: string
  position?: string | null
  team?: string | null
  imageUrl?: string | null
  /** Present → the league flavour of the card. */
  leagueId?: string | null
}

type PlayerCardState = {
  open: (ref: PlayerCardRef) => void
  close: () => void
  isOpen: boolean
}

const Ctx = createContext<PlayerCardState | null>(null)

/**
 * The league a subtree's player names belong to.
 *
 * ⚠ A CONTEXT RATHER THAN A PROP, AND THAT IS THE WHOLE REASON IT EXISTS. The
 * league id lives on the SCREEN (`MyTeamData.league.id`) while the name is
 * rendered four components down, inside a row that is reused on several screens.
 * Threading it as a prop means editing every row component, every list, and
 * every call site on six screens — and the one place somebody forgets silently
 * downgrades that surface to the universal card with nothing to show it happened.
 *
 * Wrapping a per-league screen in `<PlayerCardLeagueScope leagueId={…}>` is one
 * line and cannot be half-applied.
 */
const LeagueCtx = createContext<string | null>(null)

export function PlayerCardLeagueScope({ leagueId, children }: { leagueId: string | null; children: ReactNode }) {
  return <LeagueCtx.Provider value={leagueId}>{children}</LeagueCtx.Provider>
}

export function usePlayerCardLeague(): string | null {
  return useContext(LeagueCtx)
}

/**
 * Safe to call from any `/core` component.
 *
 * ⚠ RETURNS A NO-OP OUTSIDE THE PROVIDER RATHER THAN THROWING. A player name is
 * rendered on surfaces that are also used outside the core shell (and in unit
 * tests that mount a row in isolation); making the name component explode there
 * would trade a working card for a broken page.
 */
export function usePlayerCard(): PlayerCardState {
  const ctx = useContext(Ctx)
  return (
    ctx ?? {
      open: () => {},
      close: () => {},
      isOpen: false,
    }
  )
}

export default function PlayerCardProvider({
  children,
  leagueId = null,
}: {
  children: ReactNode
  /** The league in context, when the shell has one. Callers may override per-name. */
  leagueId?: string | null
}) {
  const [ref, setRef] = useState<PlayerCardRef | null>(null)
  const [data, setData] = useState<PlayerCardData | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  /*
   * ⚠ EVERY FETCH IS SEQUENCED AND A STALE ONE IS DISCARDED. Clicking two names
   * quickly is normal — the comps row and the trade rows are themselves player
   * names — and without this the slower of the two responses wins and paints
   * the wrong player under the right header.
   */
  const seq = useRef(0)

  const close = useCallback(() => {
    seq.current += 1
    setRef(null)
    setData(null)
    setStatus('idle')
  }, [])

  const open = useCallback(
    (next: PlayerCardRef) => {
      const mine = ++seq.current
      setRef(next)
      setData(null)
      setStatus('loading')

      const params = new URLSearchParams({ sport: next.sport })
      if (next.externalId) params.set('externalId', next.externalId)
      else if (next.sleeperId) params.set('sleeperId', next.sleeperId)
      const inLeague = next.leagueId ?? leagueId
      if (inLeague) params.set('leagueId', inLeague)

      fetch(`/api/core/player-card?${params.toString()}`, { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((json: PlayerCardData) => {
          if (seq.current !== mine) return
          setData(json)
          setStatus('ready')
        })
        .catch(() => {
          if (seq.current !== mine) return
          setStatus('error')
        })
    },
    [leagueId]
  )

  /*
   * Escape, the background scroll lock and focus restoration all moved into
   * `useOverlayContainment`, which PlayerCardSheet calls.
   *
   * ⚠ THEY HAD TO MOVE TOGETHER, NOT ONE AT A TIME. Two owners of
   * `document.body.style.overflow` cannot compose: whichever cleanup runs last
   * writes the value IT captured, so a provider-level lock plus the hook's
   * reference-counted one would restore `hidden` over an already-unlocked page,
   * or unlock underneath a second open overlay. The hook owns the whole set
   * precisely so there is one owner.
   *
   * `restoreFocus` is likewise the hook's job now: it captures the opener at the
   * moment the overlay activates, which is strictly later — and therefore more
   * accurate — than capturing it here inside `open()`.
   */

  const value = useMemo<PlayerCardState>(() => ({ open, close, isOpen: ref != null }), [open, close, ref])

  return (
    <Ctx.Provider value={value}>
      {children}
      {ref ? <PlayerCardSheet subject={ref} data={data} status={status} onClose={close} onOpen={open} /> : null}
    </Ctx.Provider>
  )
}
