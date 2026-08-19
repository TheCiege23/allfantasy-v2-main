'use client'

import { LeagueShell, type LeagueShellProps } from './LeagueShell'

/**
 * Client-boundary wrapper for the LeagueShell.
 * Keeping this boundary explicit lets the Server Component pass only serialized
 * league data while the interactive shell mounts as a normal client tree.
 */
export function LeagueShellClient(props: LeagueShellProps) {
  return <LeagueShell {...props} />
}
