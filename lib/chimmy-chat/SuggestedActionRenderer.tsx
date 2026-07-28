import React from "react"
import { isRenderableChimmyContentHref } from "./safeChimmyLinks"

type SuggestedAction = {
  label: string
  href: string
}

function extractSuggestedActions(content: string): SuggestedAction[] {
  const actions: SuggestedAction[] = []
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(content)) !== null) {
    const label = match[1]?.trim()
    const href = match[2]?.trim()
    if (!label || !href) continue
    // Security: a suggested-action BUTTON may only ever point at an internal AllFantasy route. An
    // external URL emitted by the model (or carried over from a cached prior turn) is never trusted —
    // real external source-platform actions come from server-resolved action cards, not model text.
    if (!isRenderableChimmyContentHref(href)) continue
    actions.push({ label, href })
  }
  return actions.slice(0, 3)
}

export function SuggestedActionRenderer({ content }: { content: string }) {
  const actions = extractSuggestedActions(content)
  if (actions.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((action) => (
        <a
          key={`${action.label}-${action.href}`}
          href={action.href}
          className="inline-flex items-center rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20"
          data-chimmy-suggested-action
        >
          {action.label}
        </a>
      ))}
    </div>
  )
}
