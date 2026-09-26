'use client'

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'

import CommsDock, { type CommsDockProps } from './CommsDock'

/**
 * One chat bubble for all of /core, mounted ABOVE the page so a screen change cannot unmount it.
 *
 * 🛑 THE BUBBLE VANISHED ON EVERY /core NAVIGATION. It was rendered inside `AfCoreShell`, and the
 * shell is rendered by `app/core/[[...screen]]/page.tsx` — BELOW that segment's `loading.tsx`.
 * The screen param is part of the segment key, so every screen change re-suspends, swaps the whole
 * shell for the loading skeleton, and mounts a NEW shell (and a new CommsDock) when the page lands.
 * The bubble blinked out for the whole load, and anything held only in React state — a half-typed
 * league or DM message, the open thread — was thrown away. #1307 restores open/tab/scope from
 * sessionStorage after the remount; that makes the chat come BACK, it does not stop it LEAVING
 * (owner report, 2026-09-25 handoff: "the chat bubble still vanishes for a moment while a page loads").
 *
 * So the dock now lives in `app/core/layout.tsx`, which Next.js keeps mounted across every screen
 * under /core. The page still decides WHAT the dock shows — it publishes its props from the shell,
 * because only the page knows its league, surface and counts — but the dock INSTANCE is the
 * host's, so its state survives the swap.
 *
 * WHEN IT SHOWS: while a shell has published (a /core screen is up) OR while `loading.tsx` holds it
 * (that screen's replacement is on its way). A /core page with neither — connect-leagues, the
 * signed-out landing — shows no bubble, exactly as before. The shell's release and the skeleton's
 * hold happen in the same commit, so the dock never sees a moment with no owner.
 *
 * ⚠ THE WRAPPER CARRIES `af-core`, WITH `display: contents`. Every colour the drawer resolves
 * (`--bg`, `--line`, `--surface`…) is defined on `.af-core`, not `:root`, and the dock used to
 * inherit them from the shell. `display: contents` gives it that ancestry without a box of its own.
 * `data-league-first` is mirrored for the one rule that hid the bubble through shell ancestry
 * (af-core-shell.css, "league-first" at ≤720px), which now matches this wrapper too.
 */

type Published = {
  props: CommsDockProps
  /** Mirrors the shell's `data-league-first`, which a phone CSS rule hides the bubble under. */
  leagueFirst: boolean
  /** Who published — a new shell means `.af-shell` is a new element the docked mode must re-mark. */
  by: string
}

type HostApi = {
  publish: (id: string, value: Omit<Published, 'by'>) => void
  hold: (id: string) => void
  release: (id: string) => void
}

const CommsDockHostContext = createContext<HostApi | null>(null)

export function CommsDockHost({ children }: { children: ReactNode }) {
  const [published, setPublished] = useState<Published | null>(null)
  const [owners, setOwners] = useState<ReadonlySet<string>>(() => new Set())

  const api = useMemo<HostApi>(() => {
    const add = (id: string) => setOwners((s) => (s.has(id) ? s : new Set(s).add(id)))
    return {
      publish: (id, value) => {
        setPublished({ ...value, by: id })
        add(id)
      },
      hold: add,
      release: (id) =>
        setOwners((s) => {
          if (!s.has(id)) return s
          const next = new Set(s)
          next.delete(id)
          return next
        }),
    }
  }, [])

  return (
    <CommsDockHostContext.Provider value={api}>
      {children}
      {published && owners.size > 0 ? (
        <div
          className="af-core"
          data-comms-host=""
          data-league-first={published.leagueFirst ? 'true' : undefined}
          style={{ display: 'contents' }}
        >
          <CommsDock {...published.props} shellKey={published.by} />
        </div>
      ) : null}
    </CommsDockHostContext.Provider>
  )
}

/**
 * What the shell renders where the dock used to be.
 *
 * Under the host it renders NOTHING and hands its props up; without one (a test, a preview page,
 * any future mount outside /core's layout) it renders the dock inline, as the shell always did —
 * so a missing host degrades to the old behaviour instead of to no chat at all.
 */
export function ShellCommsDock({ leagueFirst = false, ...props }: CommsDockProps & { leagueFirst?: boolean }) {
  const host = useContext(CommsDockHostContext)
  const id = useId()

  /* Every value the dock reads, so a new page's league or counts reach the one live dock. */
  const {
    leagues,
    pageLeagueId,
    chimmyTokenCost,
    chimmyPlanAllowance,
    homeSignals,
    pageSurface,
    dockable,
    supportEmail,
    unread,
    mentions,
  } = props
  useEffect(() => {
    host?.publish(id, {
      leagueFirst,
      props: {
        leagues,
        pageLeagueId,
        chimmyTokenCost,
        chimmyPlanAllowance,
        homeSignals,
        pageSurface,
        dockable,
        supportEmail,
        unread,
        mentions,
      },
    })
  }, [
    host,
    id,
    leagueFirst,
    leagues,
    pageLeagueId,
    chimmyTokenCost,
    chimmyPlanAllowance,
    homeSignals,
    pageSurface,
    dockable,
    supportEmail,
    unread,
    mentions,
  ])
  /* Released only when THIS shell goes — a prop change republishes without dropping ownership. */
  useEffect(() => {
    if (!host) return
    return () => host.release(id)
  }, [host, id])

  if (host) return null
  return <CommsDock {...props} />
}

/**
 * Rendered by `app/core/[[...screen]]/loading.tsx`: keeps the bubble up while the next screen
 * loads. Without it the dock would have no owner between the old shell leaving and the new one
 * arriving, and would unmount — the vanishing this file exists to stop.
 */
export function CommsDockHold() {
  const host = useContext(CommsDockHostContext)
  const id = useId()
  useEffect(() => {
    if (!host) return
    host.hold(id)
    return () => host.release(id)
  }, [host, id])
  return null
}
