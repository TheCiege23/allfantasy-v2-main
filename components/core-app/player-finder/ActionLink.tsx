import Link from 'next/link'
import type { ViewAction } from '@/lib/core-app/leagueViewActions'

/** One action from `leagueViewActions`: a Next link for an AllFantasy route, else an anchor (new tab when external). */
export function ActionLink({ action, className }: { action: ViewAction; className: string }) {
  if (action.internal) {
    return (
      <Link className={className} href={action.href}>
        {action.label}
      </Link>
    )
  }
  return (
    <a className={className} href={action.href} {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {action.label}
    </a>
  )
}
