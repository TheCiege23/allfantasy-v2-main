'use client'

import React from 'react'

import type { MentionSuggestion } from '@/lib/chat-core/useMentionAutocomplete'

type Props = {
  suggestions: MentionSuggestion[]
  onSelect: (suggestion: MentionSuggestion) => void
  onDismiss: () => void
}

export function MentionAutocomplete({ suggestions, onSelect, onDismiss }: Props) {
  if (!suggestions.length) return null

  return (
    <div
      className="max-h-48 overflow-y-auto border-b border-white/[0.06] px-2 py-1.5"
      role="listbox"
      aria-label="Mention suggestions"
    >
      {suggestions.map((s) => (
        <button
          key={`${s.type}-${s.value}-${s.label}`}
          type="button"
          className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-cyan-500/15"
          onClick={() => onSelect(s)}
        >
          {s.type === '@username' && s.avatarUrl ? (
            <img src={s.avatarUrl} className="h-5 w-5 rounded-full" alt="" />
          ) : null}
          {s.type === '@global' ? <span className="text-sm">📡</span> : null}
          {s.type === '@chimmy' ? <span className="text-sm">🔒</span> : null}
          {s.type === '@all' ? <span className="text-sm">📢</span> : null}
          <div>
            <span className="text-[12px] font-semibold text-white/90">{s.label}</span>
            {s.description ? (
              <span className="ml-1.5 text-[11px] text-white/45">{s.description}</span>
            ) : null}
          </div>
        </button>
      ))}
      <button type="button" className="sr-only" onClick={onDismiss}>
        dismiss
      </button>
    </div>
  )
}
