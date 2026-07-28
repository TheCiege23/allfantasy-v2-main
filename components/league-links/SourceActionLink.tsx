'use client'

/**
 * The ONE reusable "open this imported league on its source platform" affordance. It resolves the safe
 * destination via the centralized `resolveSourceLink` (pure — no provider fetch) and renders a hardened
 * external anchor (`target="_blank"` + `rel="noopener noreferrer"`). Renders nothing for native/unknown
 * leagues. Consumers pass canonical context (platform + sourceLeagueId + name [+ action]); they must NOT
 * build provider URLs themselves.
 */
import type { CSSProperties } from 'react'
import { ExternalLink } from 'lucide-react'
import { resolveSourceLink, type SourceLink, type SourceLinkContext } from '@/lib/league-links/sourceLinkResolver'
import { IMPORTED_LEAGUE_READONLY_NOTE } from '@/lib/league-links/readOnlyNote'

export interface SourceActionLinkProps extends SourceLinkContext {
  className?: string
  style?: CSSProperties
  /** Pass a pre-resolved link (e.g. resolved server-side) instead of resolving from context. */
  link?: SourceLink | null
  /** Hide the trailing external-link (↗) icon. */
  hideIcon?: boolean
}

export function SourceActionLink({ className, style, link, hideIcon, ...ctx }: SourceActionLinkProps) {
  const resolved = link ?? resolveSourceLink(ctx)
  if (!resolved) return null
  return (
    <a
      href={resolved.href}
      target="_blank"
      rel="noopener noreferrer"
      data-source-provider={resolved.provider}
      data-source-destination={resolved.destinationType}
      data-source-fallback={resolved.isFallback ? 'true' : 'false'}
      title={
        resolved.isFallback
          ? `${resolved.label} — a direct league link wasn't available, opening the platform home`
          : resolved.label
      }
      className={
        className ??
        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium'
      }
      style={style}
    >
      <span className="truncate">{resolved.label}</span>
      {hideIcon ? null : <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    </a>
  )
}

/** Concise, reusable read-only disclosure. Use once per surface — never on every card. */
export function ReadOnlyLeagueNote({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <p className={className} style={style}>
      {IMPORTED_LEAGUE_READONLY_NOTE}
    </p>
  )
}
