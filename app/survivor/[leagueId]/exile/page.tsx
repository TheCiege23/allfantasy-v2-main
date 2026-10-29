'use client'

import Link from 'next/link'
import { ExileRosterWaivers } from '@/components/league/survivor/ExileRosterWaivers'
import { ExileTokenWallet } from '@/components/league/survivor/ExileTokenWallet'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { ExileBossBoard } from '@/components/survivor/late/ExileBossBoard'

type ExileGet = {
  island?: { isActive?: boolean; currentWeek?: number; bossName?: string | null; bossWinsEnabled?: boolean; bossTokenResetOnWin?: boolean } | null
  user?: { tokenBalance?: number; playerState?: string } | null
  bossMode?: 'median' | 'fixed' | 'topN' | 'chimmy_roster'
  bossContest?: { status: 'pending' | 'locked' | 'final'; week: number; team?: string; players?: { name: string; position: string; slot: string }[]; score?: number } | null
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
          {exiledCount} players marooned · Week {data?.bossContest?.week ?? island?.currentWeek ?? ctx.currentWeek}
        </p>
      </header>

      {!isExile && ctx.isCommissioner && !ctx.survivorFairPlayActive && island?.bossWinsEnabled && data?.bossMode !== 'chimmy_roster' ? (
        <section className="relative mt-6" aria-label="Exile board">
          <ExileBossBoard leagueId={leagueId} />
        </section>
      ) : null}

      {viewerSummary ? (
        <section className="relative mt-6 survivor-panel p-5">
          <p className="text-[14px] text-white/75">The main island only sees a summary.</p>
          <p className="mt-2 text-[12px] text-white/45">Token math and exile challenges stay private to exiles.</p>
        </section>
      ) : null}

      {isExile ? (
        <>
          <div className="relative mt-6"><ExileTokenWallet leagueId={leagueId} /></div>
          <ExileRosterWaivers leagueId={leagueId} />

          {island?.bossWinsEnabled && data?.bossMode !== 'chimmy_roster' ? (
            <section className="relative mt-6" aria-label="Exile board">
              <ExileBossBoard leagueId={leagueId} />
            </section>
          ) : null}

          {island?.bossWinsEnabled && data?.bossMode === 'chimmy_roster' ? <section className="relative mt-6 rounded-2xl border border-violet-400/30 bg-violet-950/20 p-4" aria-live="polite">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-violet-200">Chimmy score to beat · Week {data?.bossContest?.week ?? island?.currentWeek ?? ctx.currentWeek}</p>
            {data?.bossContest?.status === 'pending' ? (
              <p className="mt-2 text-[13px] text-white/70">Chimmy&apos;s NBA roster has not locked yet. The contest starts once a verified lineup is set before the week&apos;s first game.</p>
            ) : data?.bossContest ? (
              <>
                <p className="mt-2 text-[13px] text-white/80">
                  {data.bossContest.status === 'final'
                    ? `Final score: ${data.bossContest.score?.toFixed(2) ?? '—'} points.`
                    : 'Lineup locked before tipoff. The score appears when the week’s results are final.'}
                </p>
                {data.bossContest.team ? <p className="mt-2 text-[12px] text-violet-200">NBA team: {data.bossContest.team}</p> : null}
                {data.bossContest.players?.length ? (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Chimmy locked lineup">
                    {data.bossContest.players.map((player, index) => (
                      <li key={`${player.name}-${index}`} className="rounded-lg border border-violet-400/20 bg-black/20 px-3 py-2 text-[12px] text-white/75">
                        <span className="font-semibold text-white">{player.slot}</span> · {player.name} ({player.position})
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-3 text-[12px] text-white/50">
                  The top Exile score above Chimmy earns one token.
                  {island.bossTokenResetOnWin ? ' A Chimmy win or tie resets unprotected Exile tokens.' : ' A Chimmy win or tie awards no token.'}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] text-white/60">Loading the weekly contest…</p>
            )}
          </section> : null}

          <section className="relative mt-6 rounded-2xl border border-violet-500/25 bg-black/30 p-4">
            <p className="text-[11px] font-bold uppercase text-violet-200">Exile challenges</p>
            <p className="mt-2 text-[12px] text-white/55">Chimmy announces available challenges and their deadlines in Exile Chat. Your main-island roster has been released; Exile continues your season with its own competition.</p>
          </section>

          <section className="relative mt-6 survivor-panel p-4">
            <p className="text-[11px] font-bold uppercase text-white/45">Exile managers</p>
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
