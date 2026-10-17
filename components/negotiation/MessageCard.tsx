'use client'

import React, { useState } from 'react'
import { Copy, Check, Pencil } from 'lucide-react'

export interface DmMessage {
  tone: 'FRIENDLY' | 'CONFIDENT' | 'CASUAL' | 'DATA_BACKED' | 'SHORT'
  message: string
  hook: string
}

const TONE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  FRIENDLY: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/25' },
  CONFIDENT: { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/25' },
  CASUAL: { bg: 'bg-cyan-500/15', text: 'text-cyan-300', border: 'border-cyan-500/25' },
  DATA_BACKED: { bg: 'bg-purple-500/15', text: 'text-purple-300', border: 'border-purple-500/25' },
  SHORT: { bg: 'bg-white/10', text: 'text-white/70', border: 'border-white/15' },
}

const TONE_LABELS: Record<string, string> = {
  FRIENDLY: 'Friendly',
  CONFIDENT: 'Confident',
  CASUAL: 'Casual',
  DATA_BACKED: 'Data-Backed',
  SHORT: 'Short',
}

export default function MessageCard({ msg, isPreferred }: { msg: DmMessage; isPreferred?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editedText, setEditedText] = useState(msg.message)

  const style = TONE_STYLES[msg.tone] || TONE_STYLES.SHORT

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editing ? editedText : msg.message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = editing ? editedText : msg.message
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-3 space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold uppercase tracking-wider ${style.text}`}>
            {TONE_LABELS[msg.tone]}
          </span>
          {isPreferred && (
            <span className="text-[11px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded-full">Your style</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditing(!editing)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors touch-manipulation"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5 text-white/40" />
          </button>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors touch-manipulation"
            title="Copy"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-white/40" />
            )}
          </button>
        </div>
      </div>

      <p className="text-xs text-white/50 italic">{msg.hook}</p>

      {editing ? (
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-white/90 resize-none focus:outline-none focus:border-cyan-400/40"
          rows={4}
        />
      ) : (
        <p className="text-sm text-white/80 leading-relaxed whitespace-pre-line">{editedText}</p>
      )}
    </div>
  )
}
