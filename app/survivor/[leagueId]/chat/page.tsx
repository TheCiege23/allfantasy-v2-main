'use client'

import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import Link from 'next/link'

type TabId = 'league' | 'tribe' | 'chimmy' | 'exile' | 'jury' | 'finale' | 'alliances'

export default function SurvivorChatPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const base = `/survivor/${leagueId}`
  const [tab, setTab] = useState<TabId>('league')

  const tribeName = useMemo(() => {
    const t = ctx.season?.tribes?.find((x) => x.id === ctx.tribeId)
    return t?.name ?? 'Tribe'
  }, [ctx.season?.tribes, ctx.tribeId])

  const tabs: { id: TabId; label: string; show: boolean; unread?: number }[] = [
    { id: 'league', label: '🌍 League', show: true },
    { id: 'tribe', label: `🔥 ${tribeName}`, show: ctx.playerState !== 'exile' && ctx.canAccessTribeChat },
    { id: 'chimmy', label: '🤖 @Chimmy', show: true },
    { id: 'alliances', label: '🤝 Alliances', show: true },
    { id: 'exile', label: '🏚 Exile', show: ctx.canAccessExileChat },
    { id: 'jury', label: '⚖️ Jury', show: ctx.canAccessJuryChat },
    { id: 'finale', label: '🏆 Finale', show: ctx.canAccessFinaleChat || ctx.leaguePhase === 'finale' },
  ]

  const visible = tabs.filter((t) => t.show)

  const shellClass = (id: TabId) => {
    if (id === 'tribe') return 'border-l-4 border-sky-500/60 bg-black/20'
    if (id === 'chimmy') return 'border-l-4 border-violet-500/50 bg-violet-950/20'
    if (id === 'exile') return 'exile-chat-fog border-l-4 border-violet-400/40 bg-[#0a0612]'
    if (id === 'jury') return 'border-l-4 border-amber-500/50 bg-amber-950/15'
    if (id === 'finale') return 'border-l-4 border-amber-400/40 bg-black/25'
    return 'border-l-4 border-transparent'
  }

  const quiet = ctx.season?.activeCouncil?.status === 'revealing'

  return (
    <div className="flex min-h-[70vh] flex-col px-3 pb-28 pt-2 md:px-6 md:pb-10">
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-2 md:gap-2">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-label={`${t.label} chat`}
            className={clsx(
              'shrink-0 rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-wide',
              tab === t.id ? 'bg-sky-500/20 text-sky-100' : 'bg-white/[0.04] text-white/50',
            )}
          >
            {t.label}
            {t.unread ? (
              <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[11px] text-white" aria-label={`${t.unread} unread`}>
                {t.unread}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className={clsx('mt-3 flex-1 rounded-2xl border border-white/[0.06] p-4', shellClass(tab))}>
        {tab === 'league' && (
          <>
            <p className="text-[11px] font-bold uppercase text-white/45">League feed</p>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border-l-4 border-[var(--survivor-torch)] bg-white/[0.04] p-3">
                <div className="flex gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--survivor-torch)]/30 text-sm">🔥</div>
                  <div>
                    <p className="text-[11px] font-bold text-[var(--survivor-torch)]">The Host</p>
                    <p className="text-[13px] text-white/75">Ceremony copy lands here — merges, swaps, and tribal stakes.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/90">
                📌 Pinned: check deadlines before tribal.
              </div>
            </div>
          </>
        )}

        {tab === 'tribe' && (
          <>
            <p className="text-[11px] font-bold uppercase text-sky-200/80">🔒 Private · {tribeName}</p>
            <p className="mt-1 text-[12px] text-white/50">Only your tribe sees this channel.</p>
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[12px] text-amber-100">
              🗳 Tribal Council tonight — vote through @Chimmy before the deadline.
            </div>
          </>
        )}

        {tab === 'chimmy' && (
          <div className="text-center">
            <p className="text-[13px] text-white/70">Private lane for votes, powers, and picks.</p>
            <Link
              href={`${base}/chimmy`}
              className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-violet-600/40 px-6 text-[14px] font-semibold text-violet-100"
            >
              Open @Chimmy room
            </Link>
          </div>
        )}

        {tab === 'exile' && (
          <>
            <p className="text-[11px] font-bold uppercase text-violet-200">🏚 Exile Island</p>
            <p className="mt-1 text-[12px] text-white/45">Main island cannot read this thread.</p>
          </>
        )}

        {tab === 'jury' && (
          <>
            <p className="text-[11px] font-bold uppercase text-amber-200">⚖️ Jury chamber</p>
            <p className="mt-1 text-[12px] text-white/50">Deliberations stay private until the finale.</p>
          </>
        )}

        {tab === 'finale' && (
          <>
            <p className="text-[11px] font-bold uppercase text-amber-100">🏆 Finale</p>
            <p className="mt-1 text-[12px] text-white/55">Closing speeches and jury energy converge here.</p>
          </>
        )}

        {tab === 'alliances' && (
          <p className="text-[13px] text-white/50">Alliance threads appear when your commissioner enables them.</p>
        )}
      </div>

      {quiet ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4 text-center text-[13px] text-white/60">
          🔇 Quiet — the votes are being read. Input locked for drama.
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <input
            disabled={ctx.playerState === 'eliminated'}
            className="min-h-[48px] flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] text-white disabled:opacity-40"
            placeholder={ctx.playerState === 'eliminated' ? 'Read-only after torch snuff' : 'Message…'}
            aria-label="Chat message"
          />
          <button
            type="button"
            disabled={ctx.playerState === 'eliminated'}
            className="min-h-[48px] rounded-xl bg-sky-600/50 px-4 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      )}

      {ctx.playerState === 'eliminated' ? (
        <p className="mt-2 text-[11px] text-white/35">Eliminated players can read league history up to their vote-out.</p>
      ) : null}
    </div>
  )
}
