'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Settings, X, Users, Shuffle, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'

/**
 * Shown after native league creation when URL includes `created=1` & `guide=settings`.
 * Surfaces quick paths into League Settings without blocking the dashboard.
 */
export function PostCreateSetupGuideBanner({
  leagueId,
  isCommissioner,
}: {
  leagueId: string
  isCommissioner: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [dismissed, setDismissed] = useState(false)

  const show = useMemo(() => {
    if (!isCommissioner || dismissed) return false
    return searchParams?.get('created') === '1' && searchParams?.get('guide') === 'settings'
  }, [isCommissioner, dismissed, searchParams])

  if (!show) return null

  const base = `/league/${leagueId}`

  const actions = [
    { label: 'League settings', href: `${base}?view=settings`, icon: Settings },
    { label: 'Draft', href: `${base}?view=draft`, icon: Trophy },
    { label: 'Players / waivers', href: `${base}?view=players`, icon: Shuffle },
    { label: 'Trades', href: `${base}?view=trades`, icon: Users },
  ]

  return (
    <div className="af-league-setup-guide border-b border-cyan-500/25 bg-gradient-to-r from-[#081a28]/95 to-[#0a1228]/95 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200">
            <Settings className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold text-white/95">Your league is ready</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-white/55">
              We applied smart defaults. Customize scoring, rosters, waivers, draft, and playoffs in League Settings when
              you are ready.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(({ label, href, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/85 transition hover:border-cyan-400/30 hover:bg-white/[0.07]"
            >
              <Icon className="h-3.5 w-3.5 opacity-80" aria-hidden />
              {label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => {
              setDismissed(true)
              const q = new URLSearchParams(searchParams?.toString() ?? '')
              q.delete('guide')
              router.replace(`${base}${q.toString() ? `?${q.toString()}` : ''}`)
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/50 hover:bg-white/[0.06] hover:text-white/80"
            aria-label="Dismiss setup guide"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
