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
import {
  resolveSourceLink,
  sourceLinkLabel,
  type SourceLink,
  type SourceLinkContext,
} from '@/lib/league-links/sourceLinkResolver'
import { IMPORTED_LEAGUE_READONLY_NOTE } from '@/lib/league-links/readOnlyNote'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * ⚠ THE CONTEXT IS `Partial` BECAUSE `link` AND `platform` ARE ALTERNATIVES, NOT
 * A PAIR. Extending `SourceLinkContext` directly made `platform` mandatory even
 * for a caller handing over a link the server already resolved — so every such
 * call site had to pass a redundant field the component would then ignore, or
 * fail to compile. Pass EITHER a resolved `link` OR the context to resolve from.
 */
export interface SourceActionLinkProps extends Partial<SourceLinkContext> {
  className?: string
  style?: CSSProperties
  /** Pass a pre-resolved link (e.g. resolved server-side) instead of resolving from context. */
  link?: SourceLink | null
  /** Hide the trailing external-link (↗) icon. */
  hideIcon?: boolean
}

export function SourceActionLink({ className, style, link, hideIcon, ...ctx }: SourceActionLinkProps) {
  /*
   * A caller with neither a link nor a platform gets nothing rendered, which is
   * the same outcome as a native league — never a broken or guessed href.
   */
  const { language } = useOptionalLanguage()
  const resolved =
    link ?? (ctx.platform != null ? resolveSourceLink(ctx as SourceLinkContext) : null)
  if (!resolved) return null
  // The label in the reader's language — the visible text and the tooltip (2026-10-03).
  const label = sourceLinkLabel(resolved, language)
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
          ? language === 'es'
            ? `${label} — no había un enlace directo a la liga; se abre la página principal de la plataforma`
            : `${label} — a direct league link wasn't available, opening the platform home`
          : label
      }
      className={
        className ??
        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium'
      }
      style={style}
    >
      <span className="truncate">{label}</span>
      {hideIcon ? null : <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
    </a>
  )
}

/** Concise, reusable read-only disclosure. Use once per surface — never on every card. */
export function ReadOnlyLeagueNote({ className, style }: { className?: string; style?: CSSProperties }) {
  const { language } = useOptionalLanguage()
  return (
    <p className={className} style={style}>
      {language === 'es'
        ? 'AllFantasy analiza y recomienda. Los cambios en las ligas importadas se hacen en la plataforma original.'
        : IMPORTED_LEAGUE_READONLY_NOTE}
    </p>
  )
}
