'use client'

import Link from 'next/link'
import { ExileRosterWaivers } from '@/components/league/survivor/ExileRosterWaivers'
import { ExileTokenWallet } from '@/components/league/survivor/ExileTokenWallet'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { ExileBossBoard } from '@/components/survivor/late/ExileBossBoard'
import { exileHeadcountLine, exilePageVisibility } from '@/lib/survivor/survivorExileSecrecy'

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
  const isExile = ctx.playerState === 'exile'
  // Exile secrecy: the season payload already says whether THIS viewer may know who is on Exile
  // (exiles and a non-playing host may). Anyone else sees no count and no names.
  const secrecy = exilePageVisibility({
    membershipHidden: ctx.season?.exileMembershipHidden === true,
    viewerIsExile: isExile,
    nonPlayingCommissioner: false,
    players: ctx.season?.players ?? [],
  })
  const viewerSummary = !isExile && (!ctx.isCommissioner || ctx.survivorFairPlayActive)
  const weekLabel = data?.bossContest?.week ?? island?.currentWeek ?? ctx.currentWeek

  return (
    <div
      className="sv-exile-wash relative min-h-[75vh] px-3 pb-28 pt-4 md:px-6 md:pb-10"
    >
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 h-32 opacity-40 motion-safe:[animation:survivor-fog-shift_18s_linear_infinite]"
        style={{
          background: `linear-gradient(0deg, rgba(139,92,246,0.15), transparent)`,
        }}
      />

      <header className="relative">
        <p className="sv-kicker text-[12px] !text-violet-200">🏚 Exile Island</p>
        <h1 className="sv-h mt-1 text-2xl md:text-3xl">{isExile ? 'Earn your way back' : 'Where voted-out players fight back'}</h1>
        <p className="mt-2 text-[13px] text-white/50" data-testid="survivor-exile-headcount">
          {secrecy.showCount ? exileHeadcountLine(secrecy.count ?? 0, weekLabel) : `Who is on Exile is secret · Week ${weekLabel}`}
        </p>
      </header>

      {!isExile && ctx.isCommissioner && !ctx.survivorFairPlayActive && island?.bossWinsEnabled && data?.bossMode !== 'chimmy_roster' ? (
        <section className="relative mt-6" aria-label="Exile board">
          <ExileBossBoard leagueId={leagueId} />
        </section>
      ) : null}

      {viewerSummary ? (
        <section className="relative mt-6 survivor-panel rounded-2xl p-5" data-testid="survivor-exile-explainer">
          {/* A player who is not on Exile used to get one line here and an empty page. Say how Exile works. */}
          <h2 className="sv-h text-[15px]">How Exile works</h2>
          <ol className="mt-3 space-y-2 text-[13px] text-white/80">
            <li>1. A player voted out at Tribal Council goes to Exile instead of leaving the game.</li>
            <li>2. Exiles keep playing each week and earn tokens by scoring well.</li>
            <li>
              3. {data?.returnRules?.enabled
                ? `In week ${data.returnRules.week}, ${data.returnRules.slots === 1 ? 'the exile' : `up to ${data.returnRules.slots} exiles`} with ${data.returnRules.tokensRequired}+ tokens can return to the game.`
                : 'Enough tokens can buy a way back into the game, when the commissioner opens a return.'}
            </li>
          </ol>
          <p className="mt-3 text-[12px] text-white/60">
            {secrecy.showCount ? 'Token totals and Exile challenges stay private to the exiles.' : 'In this league nobody outside Exile knows who is there. Token totals and Exile challenges stay private to the exiles.'}
          </p>
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
            <p className="sv-kicker text-[11px] !text-violet-200">Chimmy score to beat · Week {data?.bossContest?.week ?? island?.currentWeek ?? ctx.currentWeek}</p>
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
            <p className="sv-kicker text-[11px] !text-violet-200">Exile challenges</p>
            <p className="mt-2 text-[12px] text-white/55">Chimmy announces available challenges and their deadlines in Exile Chat. Your main-island roster has been released; Exile continues your season with its own competition.</p>
          </section>

          <section className="relative mt-6 survivor-panel rounded-2xl p-4">
            <p className="sv-kicker text-[11px]">Exile managers</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(secrecy.showMembers ? ctx.season?.players ?? [] : [])
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
