import Link from 'next/link'
import type { DemoTeam } from '@/lib/demo-league/types'

/** Initials avatar — a demo team never has an image, so there is no URL to leak. */
export function TeamBadge({ team, size = 32, link = true }: { team: DemoTeam | undefined; size?: number; link?: boolean }) {
  if (!team) return <span className="af-muted">Unknown team</span>
  const dot = (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white"
      style={{ width: size, height: size, background: team.color }}
    >
      {team.initials}
    </span>
  )
  const body = (
    <span className="flex min-w-0 max-w-full items-center gap-2">
      {dot}
      <span className="min-w-0">
        <span className="block truncate font-semibold">{team.teamName}</span>
        <span className="block truncate text-xs af-muted">{team.managerName}</span>
      </span>
    </span>
  )
  return link ? <Link href={`/demo/teams/${team.slot}`} className="block min-w-0 max-w-full hover:underline">{body}</Link> : body
}
