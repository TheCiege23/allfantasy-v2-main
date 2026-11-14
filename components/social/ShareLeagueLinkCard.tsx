'use client'

import { useState, useEffect, useCallback } from 'react'
import { Link2, Copy, Share2, Check } from 'lucide-react'

interface ShareLeagueLinkCardProps {
  leagueId: string
}

export function ShareLeagueLinkCard({ leagueId }: ShareLeagueLinkCardProps) {
  const [joinUrl, setJoinUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/invite`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) return null
        return r.json()
      })
      .then((data) => {
        if (active && data?.joinUrl) setJoinUrl(data.joinUrl)
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [leagueId])

  const copyLink = useCallback(() => {
    if (!joinUrl) return
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [joinUrl])

  const shareLink = useCallback(() => {
    if (!joinUrl || !navigator.share) {
      copyLink()
      return
    }
    navigator.share({
      title: 'Join my fantasy league',
      text: 'Join my league on AllFantasy',
      url: joinUrl,
    }).catch(() => copyLink())
  }, [joinUrl, copyLink])

  if (loading || !joinUrl) return null

  return (
    <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Share league</h3>
      </div>
      <p className="text-xs text-white/60 mb-3">Invite friends with this link. Only commissioners can see it.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          readOnly
          value={joinUrl}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white max-w-md"
        />
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
          <button
            type="button"
            onClick={shareLink}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/30"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
        )}
      </div>
    </section>
  )
}
