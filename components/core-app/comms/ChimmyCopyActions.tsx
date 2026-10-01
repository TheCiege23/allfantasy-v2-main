'use client'

import { Copy, Share2 } from 'lucide-react'
import { useState } from 'react'
import { chimmyReplyAsPlainText, chimmyReplyAsSocialPost } from '@/lib/chimmy-chat/copyText'

/**
 * Copy one Chimmy reply: the whole answer as clean text, or a short post for socials. Each reply
 * carries its own buttons, so an earlier answer can be copied too.
 */
export function ChimmyCopyActions({ text }: { text: string }) {
  const [copied, setCopied] = useState<'text' | 'social' | 'failed' | null>(null)
  const copy = async (kind: 'text' | 'social') => {
    const value = kind === 'text' ? chimmyReplyAsPlainText(text) : chimmyReplyAsSocialPost(text)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(value)
      setCopied(kind)
    } catch {
      setCopied('failed')
    }
    window.setTimeout(() => setCopied(null), 2000)
  }
  if (!text.trim()) return null
  return (
    <div className="af-cm-copy" role="group" aria-label="Copy this answer">
      <button type="button" className="af-cm-copy-btn" onClick={() => void copy('text')}>
        <Copy size={13} aria-hidden />
        <span>{copied === 'text' ? 'Copied' : 'Copy'}</span>
      </button>
      <button type="button" className="af-cm-copy-btn" onClick={() => void copy('social')}>
        <Share2 size={13} aria-hidden />
        <span>{copied === 'social' ? 'Copied' : 'Copy for socials'}</span>
      </button>
      {copied === 'failed' ? <span className="af-cm-copy-note" role="status">Copy is blocked in this browser.</span> : null}
    </div>
  )
}
