'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ZombieStatusBadge } from '@/app/zombie/components/ZombieStatusBadge'
import { useZombieDmCommand } from '@/app/zombie/components/chimmy/useZombieDmCommand'
import { ZOMBIE_ITEM_ICON } from '@/lib/zombie/iconSystem'

type ItemRow = {
  id: string
  itemType: string
  itemLabel: string
  isUsed: boolean
  isExpired: boolean
  acquiredAt: string
  acquiredReason: string | null
  activationState?: string
}

type InvPayload = {
  items: ItemRow[]
  teamStatus: string
  rules: { reviveThreshold: number; serumMaxHold: number; weaponShieldThreshold: number; weaponAmbushThreshold: number }
  history: Array<{ id: string; actionType: string; week: number; createdAt: string; isValid: boolean }>
  resolution: { status: string } | null
  isWhisperer: boolean
  ambushesRemaining: number | null
  week: number
  isCommissionerView: boolean
}

function iconForType(t: string): string {
  const k = t.toLowerCase()
  if (k.includes('serum')) return ZOMBIE_ITEM_ICON.serum_antidote
  if (k.includes('knife')) return ZOMBIE_ITEM_ICON.weapon_knife
  if (k.includes('axe')) return ZOMBIE_ITEM_ICON.weapon_axe
  if (k.includes('bow')) return ZOMBIE_ITEM_ICON.weapon_bow
  if (k.includes('gun')) return ZOMBIE_ITEM_ICON.weapon_gun
  if (k.includes('bomb')) return ZOMBIE_ITEM_ICON.weapon_bomb
  return '⚔️'
}

function chatPrefill(leagueId: string, text: string) {
  return `/league/${leagueId}?zombieChimmy=${encodeURIComponent(text)}`
}

export default function ZombieItemsPage() {
  const { leagueId  } = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const [data, setData] = useState<InvPayload | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [bombOpen, setBombOpen] = useState(false)
  const { isSending, feedback, sendCommand } = useZombieDmCommand(leagueId ?? '')

  const load = useCallback(() => {
    if (!leagueId) return
    fetch(`/api/zombie/inventory?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: InvPayload | null) => setData(d))
      .catch(() => setData(null))
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  const serums = useMemo(() => data?.items.filter((i) => i.itemType.toLowerCase().includes('serum') && !i.isUsed) ?? [], [data])
  const weapons = useMemo(() => data?.items.filter((i) => !i.itemType.toLowerCase().includes('serum') && !i.isUsed) ?? [], [data])
  const serumCount = serums.length
  const maxSerum = data?.rules.serumMaxHold ?? 5
  const reviveNeed = data?.rules.reviveThreshold ?? 3
  const isZombie = (data?.teamStatus ?? '').toLowerCase().includes('zombie')
  const isSurvivor = (data?.teamStatus ?? '').toLowerCase().includes('survivor')
  const bomb = weapons.find((w) => w.itemType.toLowerCase().includes('bomb'))
  const nonBombWeapons = weapons.filter((w) => !w.itemType.toLowerCase().includes('bomb'))

  if (!leagueId) return null
  if (!data) {
    return <p className="text-[13px] text-[var(--zombie-text-dim)]">Loading inventory…</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <ZombieStatusBadge status={data.teamStatus} />
          <div>
            <h1 className="text-lg font-bold text-[var(--zombie-text-full)]">Your Arsenal</h1>
            <p className="text-[12px] text-[var(--zombie-text-dim)]">
              {serumCount} serums · {nonBombWeapons.length} weapons · {data.items.filter((i) => !i.isUsed).length} total
              items
            </p>
          </div>
        </div>
        {data.isCommissionerView ? (
          <p className="mt-2 text-[11px] text-amber-200/80">Commissioner view — another manager&apos;s inventory.</p>
        ) : null}
      </header>

      <section className="rounded-xl border border-teal-500/25 bg-teal-950/20 p-4">
        <h2 className="text-[14px] font-bold text-teal-200">🧪 Serums</h2>
        <p className="mt-1 text-3xl font-black text-white">
          {serumCount}
          <span className="text-[14px] font-normal text-[var(--zombie-text-dim)]"> / {maxSerum} max</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-1 text-2xl" aria-hidden>
          {Array.from({ length: maxSerum }).map((_, i) => (
            <span key={i}>{i < serumCount ? '🧪' : '⬜'}</span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowRules((s) => !s)}
          className="mt-3 text-[12px] text-teal-300/90 underline"
        >
          {showRules ? 'Hide' : 'Show'} serum rules
        </button>
        {showRules ? (
          <ul className="mt-2 list-inside list-disc text-[12px] text-[var(--zombie-text-mid)]">
            <li>Use before kickoff via @Chimmy to protect yourself or an ally this week (1 serum).</li>
            <li>Revive requires {reviveNeed} serums.</li>
          </ul>
        ) : null}
        {!data.isCommissionerView ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => void sendCommand('@Chimmy use serum protect myself')}
              disabled={isSending}
              className="flex min-h-[56px] items-center justify-center rounded-xl bg-teal-600/30 px-4 text-center text-[13px] font-semibold text-teal-100 hover:bg-teal-600/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              🧪 Use Serum — Protect Myself
            </button>
            <Link
              href={chatPrefill(leagueId, '@Chimmy use serum protect ally ')}
              className="flex min-h-[56px] items-center justify-center rounded-xl bg-teal-600/20 px-4 text-center text-[13px] font-semibold text-teal-100/90 hover:bg-teal-600/30"
            >
              🧪 Use Serum — Protect Ally
            </Link>
            {isZombie && serumCount >= reviveNeed ? (
              <button
                type="button"
                onClick={() => void sendCommand('@Chimmy revive')}
                disabled={isSending}
                className="flex min-h-[56px] items-center justify-center rounded-xl bg-amber-500/25 px-4 text-center text-[13px] font-semibold text-amber-100 hover:bg-amber-500/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                ⚡ Revive
              </button>
            ) : null}
          </div>
        ) : null}
        {feedback ? (
          <p className={feedback.kind === 'success' ? 'mt-3 text-[12px] text-emerald-200/90' : 'mt-3 text-[12px] text-red-200/90'}>
            {feedback.text}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-amber-500/20 bg-[var(--zombie-panel)] p-4">
        <h2 className="text-[14px] font-bold text-amber-200">⚔️ Weapons</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {nonBombWeapons.length === 0 ? (
            <div className="col-span-2 rounded-lg border border-dashed border-white/15 p-4 text-center text-[12px] text-[var(--zombie-text-dim)] md:col-span-4">
              No weapons held. Earn by scoring {data.rules.weaponShieldThreshold}+ (shield) or{' '}
              {data.rules.weaponAmbushThreshold}+ (offense) — sport rules apply.
            </div>
          ) : null}
          {nonBombWeapons.map((w) => {
            const zombieLocked = isZombie && !w.itemType.toLowerCase().includes('knife')
            return (
              <div
                key={w.id}
                className="rounded-lg border border-white/[0.08] bg-black/20 p-3 text-center"
              >
                <div className="text-4xl">{iconForType(w.itemType)}</div>
                <p className="mt-1 text-[11px] font-semibold text-white">{w.itemLabel}</p>
                <p className="text-[11px] text-[var(--zombie-text-dim)]">{w.activationState ?? 'READY'}</p>
                {!data.isCommissionerView && !zombieLocked ? (
                  <button
                    type="button"
                    onClick={() => void sendCommand(`@Chimmy use ${w.itemType.replace(/_/g, ' ')}`)}
                    disabled={isSending}
                    className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-orange-500/20 text-[11px] font-semibold text-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Use via @Chimmy
                  </button>
                ) : (
                  <p className="mt-2 text-[11px] text-[var(--zombie-text-dim)]" title={zombieLocked ? 'Zombies cannot activate most weapons' : ''}>
                    {zombieLocked ? '🔒 Locked' : '—'}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {bomb ? (
        <section className="rounded-xl border-2 border-[var(--zombie-red)]/50 bg-red-950/30 p-4">
          <h2 className="text-[15px] font-bold text-red-200">💣 BOMB</h2>
          <p className="mt-1 text-[12px] text-red-100/80">
            ONE USE PER SEASON. Destroys the top Zombie&apos;s weekly winnings (when rules allow).
          </p>
          {!data.isCommissionerView && isSurvivor ? (
            <>
              <button
                type="button"
                onClick={() => setBombOpen(true)}
                className="mt-3 w-full min-h-[56px] rounded-xl bg-red-600/40 text-[13px] font-bold text-white hover:bg-red-600/55"
              >
                🔴 Detonate via @Chimmy
              </button>
              {bombOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                  <div className="max-w-sm rounded-2xl border border-red-500/40 bg-[#1a0a0a] p-4">
                    <p className="text-[13px] text-red-100">
                      Are you sure? Type DETONATE in chat after confirm. This cannot be undone.
                    </p>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setBombOpen(false)}
                        className="flex-1 rounded-lg bg-white/10 py-3 text-[13px]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await sendCommand('@Chimmy 💣 detonate bomb')
                          if (ok) setBombOpen(false)
                        }}
                        disabled={isSending}
                        className="flex flex-1 items-center justify-center rounded-lg bg-red-600 py-3 text-center text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSending ? 'Sending…' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-[11px] text-red-200/70">{isSurvivor ? '' : '🔒 Only Survivors can arm the bomb.'}</p>
          )}
          {feedback ? (
            <p className={feedback.kind === 'success' ? 'mt-3 text-[12px] text-emerald-200/90' : 'mt-3 text-[12px] text-red-200/90'}>
              {feedback.text}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-4">
        <h2 className="text-[13px] font-bold text-white">Active bonuses (this week)</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-white/10 px-2 py-1 text-[var(--zombie-text-mid)]">
            Passive modifiers apply when held — see rules doc
          </span>
          {data.resolution?.status === 'resolving' ? (
            <span className="rounded-full bg-amber-500/20 px-2 py-1 text-amber-100">Week resolving…</span>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-4">
        <button
          type="button"
          onClick={() => setShowHistory((s) => !s)}
          className="flex w-full min-h-[44px] items-center justify-between text-left text-[13px] font-semibold text-white"
        >
          Item history
          <span className="text-[var(--zombie-text-dim)]">{showHistory ? '▲' : '▼'}</span>
        </button>
        {showHistory ? (
          <ul className="mt-2 space-y-2 border-t border-white/[0.06] pt-2 text-[12px] text-[var(--zombie-text-mid)]">
            {data.history.length === 0 ? <li>No logged actions yet.</li> : null}
            {data.history.map((h) => (
              <li key={h.id} className="flex gap-2">
                <span>{h.isValid ? '✓' : '✗'}</span>
                <span>
                  Week {h.week} · {h.actionType} · {new Date(h.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="text-center text-[11px] text-[var(--zombie-text-dim)]">
        Actions post to league chat via @Chimmy — open{' '}
        <Link href={`/zombie/${leagueId}/chat`} className="text-sky-400 underline">
          Zombie chat hub
        </Link>
        .
      </p>
    </div>
  )
}
