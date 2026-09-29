'use client'

/**
 * components/league-settings/DuplicateManagerWarningsSection.tsx
 * Commissioner-facing "Possible duplicate manager detected" warnings.
 * Mounted inside MemberSettingsCommissionerPanel, commissioner/co-commissioner only.
 * Never renders raw IP/device/fingerprint data — only pre-summarized reason labels.
 */

import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, Check, Ban, Home, UserSearch } from 'lucide-react'
import { toast } from 'sonner'

type DuplicateManagerFlag = {
  id: string
  riskLevel: string
  status: string
  summary: string
  reasons: string[]
  comparedTeams: string[]
  createdAt: string
  commissionerNote: string | null
}

const RISK_STYLES: Record<string, { label: string; className: string }> = {
  high: { label: 'High risk', className: 'border-red-500/30 bg-red-950/25 text-red-300' },
  medium: { label: 'Medium risk', className: 'border-amber-500/30 bg-amber-950/25 text-amber-300' },
  low: { label: 'Low risk', className: 'border-white/15 bg-white/5 text-white/60' },
}

const OPEN_STATUSES = new Set(['pending_review', 'flagged'])

export function DuplicateManagerWarningsSection({ leagueId }: { leagueId: string }) {
  const [flags, setFlags] = useState<DuplicateManagerFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/duplicate-flags`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setFlags(Array.isArray(data.flags) ? data.flags : [])
    } catch {
      // Non-fatal — this section is supplementary to the main member list.
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const resolve = useCallback(
    async (flagId: string, action: 'allow' | 'block' | 'household' | 'verification_requested') => {
      setActionLoading(flagId)
      try {
        const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/duplicate-flags/${encodeURIComponent(flagId)}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        if (!res.ok) {
          toast.error('Could not update this flag')
          return
        }
        toast.success('Updated')
        await load()
      } catch {
        toast.error('Could not update this flag')
      } finally {
        setActionLoading(null)
      }
    },
    [leagueId, load]
  )

  const openFlags = flags.filter((f) => OPEN_STATUSES.has(f.status))
  if (loading || openFlags.length === 0) return null

  return (
    <div className="space-y-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300/80">
        <ShieldAlert className="h-3.5 w-3.5" />
        Possible duplicate manager detected
      </p>
      {openFlags.map((flag) => {
        const risk = RISK_STYLES[flag.riskLevel] ?? RISK_STYLES.low
        const busy = actionLoading === flag.id
        return (
          <div key={flag.id} className="rounded-lg border border-white/15 bg-[#0d1526] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-[11px] font-bold uppercase ${risk.className}`}>{risk.label}</span>
              {flag.status === 'pending_review' && (
                <span className="rounded border border-cyan-500/25 bg-cyan-950/25 px-2 py-0.5 text-[11px] font-bold uppercase text-cyan-300">
                  Join on hold
                </span>
              )}
              <span className="text-[11px] text-white/50">vs. {flag.comparedTeams.join(', ') || 'existing manager'}</span>
            </div>
            <p className="mb-2 text-[12px] text-white/70">{flag.summary}</p>
            {flag.reasons.length > 0 && (
              <ul className="mb-3 space-y-1">
                {flag.reasons.map((reason) => (
                  <li key={reason} className="text-[11px] text-white/50">
                    • {reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve(flag.id, 'allow')}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-950/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-950/40 disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Allow
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve(flag.id, 'block')}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-950/25 px-2.5 py-1 text-[11px] font-semibold text-red-300 transition hover:bg-red-950/40 disabled:opacity-50"
              >
                <Ban className="h-3 w-3" /> Block
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve(flag.id, 'household')}
                className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-950/25 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 transition hover:bg-cyan-950/40 disabled:opacity-50"
              >
                <Home className="h-3 w-3" /> Mark as household
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve(flag.id, 'verification_requested')}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-50"
              >
                <UserSearch className="h-3 w-3" /> Request verification
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
