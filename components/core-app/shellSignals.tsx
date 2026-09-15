'use client'

import { createContext, useContext, useEffect } from 'react'

/**
 * Shell chrome that only the SCREEN can know — published up from a streamed screen body.
 *
 * WHY. /core renders its shell (rail, nav, league tabs, topbar) before the screen's loaders
 * finish, so the shell paints immediately and the screen streams in behind it. Four pieces of
 * chrome depended on screen data, and would otherwise force the shell to wait for the slowest
 * screen read — exactly the wait streaming exists to remove:
 *
 *   weekLabel      the topbar week ("Week 3"), from the home's dash34 read
 *   urgencyBadges  per-tab badge counts, computed after the home refreshes its lineup facts
 *   homeSignals    the ids and counts the home shows, handed to the Chimmy dock
 *   liveGameCount  the Live tab's own slate count, on the live screen only
 *
 * So the shell renders what it knows, and the screen publishes the rest when it arrives.
 *
 * ⚠ `undefined` MEANS "THIS SCREEN SAYS NOTHING", NOT "CLEAR IT". A screen that does not know
 * a signal leaves the shell's own value standing (the shell's liveGameCount, for instance, comes
 * from the activity snapshot). `null` is a real value — "we could not compute it" — and
 * overrides, exactly as the prop did before streaming.
 *
 * ⚠ SIGNALS DIE WITH THE SCREEN THAT PUBLISHED THEM. The publisher clears on unmount, so the
 * home's week label or Chimmy signals cannot survive a navigation to a screen that never
 * computed them.
 *
 * ⚠ THE COST, ACCEPTED: THESE ARE NOT IN THE SERVER HTML. They arrive when the screen's boundary
 * hydrates, so the tab badges and the week label appear with the screen rather than with the
 * shell, are absent while the screen skeleton or its error panel shows, and Chimmy opened before
 * the home finishes gets no home signals. The alternative — the shell waiting for the screen — is
 * what this file exists to remove. Streaming them as server slots is the fix if that ever matters.
 */

export type ShellUrgencyBadges = {
  myTeam?: number | null
  trades?: number | null
  draftHq?: number | null
  sync?: number | null
} | null

export type ShellSignals = {
  weekLabel?: string | null
  urgencyBadges?: ShellUrgencyBadges
  homeSignals?: string | null
  liveGameCount?: number | null
}

type Publish = (signals: ShellSignals | null) => void

export const ShellSignalsContext = createContext<Publish | null>(null)

type SignalBearingProps = {
  weekLabel?: string | null
  urgencyBadges?: ShellUrgencyBadges
  liveGameCount?: number | null
  comms?: { homeSignals?: string | null } | null
}

const pick = <T,>(published: T | undefined, own: T): T => (published === undefined ? own : published)

/** The shell's props with whatever the current screen published laid over them. */
export function withPublishedSignals<P extends SignalBearingProps>(props: P, published: ShellSignals | null): P {
  if (!published) return props
  return {
    ...props,
    weekLabel: pick(published.weekLabel, props.weekLabel),
    urgencyBadges: pick(published.urgencyBadges, props.urgencyBadges),
    liveGameCount: pick(published.liveGameCount, props.liveGameCount),
    comms:
      props.comms && published.homeSignals !== undefined
        ? { ...props.comms, homeSignals: published.homeSignals }
        : props.comms,
  }
}

/**
 * Rendered by a streamed screen body. Renders nothing; publishes on mount and whenever the
 * values change, and clears on unmount.
 *
 * Keyed on the serialised signals, so a re-render that produces the same values (every
 * `router.refresh()` on game day) does not re-publish or re-render the shell.
 */
export function PublishShellSignals(signals: ShellSignals) {
  const publish = useContext(ShellSignalsContext)
  const serialised = JSON.stringify(signals)
  useEffect(() => {
    if (!publish) return
    publish(JSON.parse(serialised) as ShellSignals)
    return () => publish(null)
  }, [publish, serialised])
  return null
}
