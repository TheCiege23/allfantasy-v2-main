'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'

type ExileGet = {
  island?: { isActive?: boolean; currentWeek?: number; bossName?: string | null } | null
  user?: { tokenBalance?: number; playerState?: string } | null
  returnRules?: { enabled: boolean; week: number; tokensRequired: number; resolved: boolean; slots: number }
  error?: string
}

export default function SurvivorExilePage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const base = `/survivor/${leagueId}`
  const [data, setData] = useState<ExileGet | null>(null)

  useEffect(() => {
    if (!leagueId) return
    fetch(`/api/survivor/exile?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: 'Failed to load' }))
  }, [leagueId])

  const island = data?.island
  const exiledCount = (ctx.season?.players ?? []).filter((p) => p.playerState === 'exile').length
  const isExile = ctx.playerState === 'exile'
  const viewerSummary = !isExile && (!ctx.isCommissioner || ctx.survivorFairPlayActive)

  return (
    <div
      className="relative min-h-[75vh] px-3 pb-28 pt-4 md:px-6 md:pb-10"
      style={{
        background: 'linear-gradient(180deg, #0c0818 0%, var(--survivor-bg) 45%, #070510 100%)',
      }}
    >
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 h-32 opacity-40"
        style={{
          background: `linear-gradient(0deg, rgba(139,92,246,0.15), transparent)`,
          animation: 'survivor-fog-shift 18s linear infinite',
        }}
      />

      <header className="relative">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-violet-300/90">🏚 Exile Island</p>
        <h1 className="mt-1 text-2xl font-black uppercase tracking-wide text-white/90">Isolation · Grind · Return</h1>
        <p className="mt-2 text-[13px] text-white/50">
          {exiledCount} players marooned · Week {island?.currentWeek ?? ctx.currentWeek}
        </p>
      </header>

      {viewerSummary ? (
        <section className="relative mt-6 survivor-panel p-5">
          <p className="text-[14px] text-white/75">The main island only sees a summary.</p>
          <p className="mt-2 text-[12px] text-white/45">Token math and exile challenges stay private to exiles.</p>
        </section>
      ) : null}

      {isExile ? (
        <>
          <section className="relative mt-6 rounded-2xl border border-violet-500/30 bg-violet-950/30 p-5">
            <p className="text-[11px] font-bold uppercase text-violet-200">Your exile status</p>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-600/30 text-lg font-bold ring-2 ring-violet-400/40">
                {(ctx.season?.userState?.displayName ?? 'You').slice(0, 1)}
              </div>
              <div>
                <p className="font-semibold text-white">{ctx.season?.userState?.displayName}</p>
                <p className="font-mono text-2xl text-violet-100">{data?.user?.tokenBalance ?? ctx.tokenBalance ?? 0} 🪙</p>
              </div>
            </div>
            <p className="mt-3 text-[12px] text-white/55">
              {data?.returnRules ? data.returnRules.resolved ? 'The return deadline has passed.' : `Earn at least ${data.returnRules.tokensRequired} tokens by the end of Week ${data.returnRules.week}. The system selects ${data.returnRules.slots} return spot after results are final.` : 'Loading return rules…'}
            </p>
            <Link href={`${base}/exile/tokens`} className="mt-3 inline-block text-[13px] font-semibold text-violet-200">
              Token pool →
            </Link>
          </section>

          <section className="relative mt-6 rounded-2xl border border-violet-500/25 bg-black/30 p-4">
            <p className="text-[11px] font-bold uppercase text-violet-200">Exile challenges</p>
            <p className="mt-2 text-[12px] text-white/55">Chimmy announces available challenges and their deadlines in Exile Chat. Your main-island roster has been released; Exile continues your season with its own competition.</p>
          </section>

          <section className="relative mt-6 survivor-panel p-4">
            <p className="text-[11px] font-bold uppercase text-white/45">Exile roster</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(ctx.season?.players ?? [])
                .filter((p) => p.playerState === 'exile')
                .map((p) => (
                  <span key={p.userId} className="rounded-full border border-violet-500/25 px-3 py-1 text-[12px] text-white/80">
                    {p.displayName}
                  </span>
                ))}
            </div>
          </section>

          <Link
            href={`${base}/chat`}
            className="relative mt-6 inline-flex min-h-[48px] items-center rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 text-[13px] text-violet-100"
          >
            💬 Open Exile Chat
          </Link>
        </>
      ) : null}

      {data?.error ? <p className="relative mt-4 text-[12px] text-red-300">{data.error}</p> : null}
    </div>
  )
}
