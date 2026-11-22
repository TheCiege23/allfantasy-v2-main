'use client'

import { useState } from 'react'
import { Link2, Check } from 'lucide-react'

interface MockDraftInviteLinkProps {
  inviteLink: string | null
  draftId: string
  status: string
  onCopy?: () => void
}

export function MockDraftInviteLink({ inviteLink, draftId, status, onCopy }: MockDraftInviteLinkProps) {
  const [copied, setCopied] = useState(false)
  const url = inviteLink ?? ''

  const handleCopy = () => {
    if (!url) return
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      onCopy?.()
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (status !== 'pre_draft' || !url) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/80">
      <Link2 className="h-4 w-4 text-cyan-400" />
      <span className="text-white/70">Invite link (mock-only):</span>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-cyan-200 hover:bg-cyan-500/25"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}
