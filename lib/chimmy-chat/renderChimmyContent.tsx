import React from 'react'
import { isRenderableChimmyContentHref } from './safeChimmyLinks'

/**
 * THE single safe renderer for Chimmy message content. Markdown links `[label](href)` become live anchors
 * ONLY for internal app routes (`/…`); an external / arbitrary URL from model text (or a cached prior turn)
 * is shown as plain text — never a clickable external link. Keeping this in one place means the URL-injection
 * hardening cannot drift between the drawer, the full-page bubble, and the compact structured renderer.
 */
export function renderChimmyContentWithLinks(text: string): React.ReactNode {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>)
    }
    const href = match[2]
    if (isRenderableChimmyContentHref(href)) {
      nodes.push(
        <a key={`l-${match.index}`} href={href} className="underline text-cyan-300 hover:text-cyan-200">
          {match[1]}
        </a>,
      )
    } else {
      nodes.push(<span key={`x-${match.index}`}>{match[1]}</span>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(<span key="t-end">{text.slice(lastIndex)}</span>)
  return <div className="whitespace-pre-wrap break-words">{nodes.length ? nodes : text}</div>
}
