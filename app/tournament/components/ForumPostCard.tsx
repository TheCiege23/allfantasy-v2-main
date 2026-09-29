'use client'

import { useState } from 'react'
import { Bot } from 'lucide-react'

const typeMeta: Record<
  string,
  { label: string; className: string; border: string }
> = {
  welcome: { label: 'ANNOUNCEMENT', className: 'bg-red-500/15 text-red-100', border: 'border-l-red-500/50' },
  round_summary: { label: 'AI RECAP', className: 'bg-cyan-500/15 text-cyan-100', border: 'border-l-cyan-500/50' },
  qualifier_announced: { label: 'ROUND RESULTS', className: 'bg-yellow-500/15 text-yellow-100', border: 'border-l-yellow-500/50' },
  draft_scheduled: { label: 'DRAFT NOTICE', className: 'bg-blue-500/15 text-blue-100', border: 'border-l-blue-500/50' },
  default: { label: 'UPDATE', className: 'bg-white/10 text-white/80', border: 'border-l-white/20' },
}

export function ForumPostCard({
  type,
  title,
  content,
  createdAt,
  pinned,
  readOnly,
}: {
  type: string
  title: string
  content: string
  createdAt: string
  pinned?: boolean
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const meta = typeMeta[type] ?? typeMeta.default
  const lines = content.split('\n').filter(Boolean)
  const preview = lines.slice(0, 3).join('\n')
  const isLarge = type === 'qualifier_announced' || type === 'round_started'

  return (
    <article
      className={`rounded-xl border border-[var(--tournament-border)] bg-[var(--tournament-panel)] p-4 ${meta.border} border-l-4 ${
        isLarge ? 'md:p-5' : ''
      } ${readOnly ? 'opacity-95' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {pinned ? <span title="Pinned">📌</span> : null}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
          {type === 'round_summary' ? <Bot className="h-4 w-4 text-cyan-300" /> : <span>📣</span>}
        </div>
        <div className="flex-1">
          <p className="text-[11px] text-[var(--tournament-text-dim)]">
            {new Date(createdAt).toLocaleString()}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.className}`}>{meta.label}</span>
      </div>
      <h3 className={`mt-2 font-bold text-white ${isLarge ? 'text-[17px]' : 'text-[14px]'}`}>{title}</h3>
      <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[var(--tournament-text-mid)]">
        {open ? content : preview}
        {!open && content.length > preview.length ? '…' : ''}
      </p>
      {content.length > preview.length ? (
        <button
          type="button"
          className="mt-2 text-[12px] font-semibold text-[var(--tournament-active)] hover:underline"
          onClick={() => setOpen(!open)}
          data-testid="forum-read-more"
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      ) : null}
      <div className="mt-3 flex gap-3 text-[12px] text-[var(--tournament-text-dim)]">
        <span>👍 0</span>
        <span>🔥 0</span>
        <span>😮 0</span>
      </div>
    </article>
  )
}
