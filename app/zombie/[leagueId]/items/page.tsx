'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useZombieDmCommand } from '@/app/zombie/components/chimmy/useZombieDmCommand'
import { ZombieStatusChip, zombieChipStatus } from '@/components/zombie/ZombieStatusChip'

/* The Armory shows the live serum and defensive weapon commands. Bomb effects remain inactive. */

type ItemRow = {
  id: string
  itemType: string
  itemLabel: string
  isUsed: boolean
  isExpired: boolean
  acquiredAt: string
  acquiredReason: string | null
  activationState?: string | null
  activatesAtWeek?: number | null
  usedAtWeek?: number | null
}

type InvPayload = {
  items: ItemRow[]
  teamStatus: string
  rules: {
    reviveThreshold: number
    serumMaxHold: number
    weaponShieldThreshold: number
    weaponAmbushThreshold: number
    weaponAxeMargin?: number
  }
  history: Array<{ id: string; actionType: string; week: number; createdAt: string; isValid: boolean }>
  resolution: { status: string } | null
  isCommissionerView: boolean
  experienceMode: string | null
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })

/** The five weapons, how the engine awards each (weaponEngine.checkAndAwardWeapons). */
function weaponCatalog(rules: InvPayload['rules']) {
  return [
    { type: 'weapon_knife', label: 'Knife', art: 'weapon-knife', earn: `Score ${fmt(rules.weaponShieldThreshold)}+ in a week` },
    { type: 'weapon_bow', label: 'Bow', art: 'weapon-bow', earn: `Score ${fmt(rules.weaponAmbushThreshold)}+ in a week` },
    { type: 'weapon_axe', label: 'Axe', art: 'weapon-axe', earn: rules.weaponAxeMargin != null ? `Win a matchup by ${fmt(rules.weaponAxeMargin)}+` : 'Win a matchup big' },
    { type: 'weapon_gun', label: 'Gun', art: 'weapon-gun', earn: 'Survive 3 Zombie attacks' },
    { type: 'weapon_bomb', label: 'Bomb', art: 'weapon-bomb', earn: 'Win 5 straight as a Survivor' },
  ]
}

const isSerum = (i: ItemRow) => i.itemType.toLowerCase().includes('serum')

export default function ZombieArmoryPage() {
  const { leagueId } = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const [data, setData] = useState<InvPayload | null>(null)
  const [showHistory, setShowHistory] = useState(false)
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

  const held = useMemo(() => (data?.items ?? []).filter((i) => !i.isUsed && !i.isExpired), [data])
  const armedShield = held.find((i) => i.activationState === 'pending_activation') ?? null
  const serums = held.filter(isSerum)
  const registered = serums.find((s) => s.activationState === 'pending_activation') ?? null
  const readySerums = serums.filter((s) => s.activationState !== 'pending_activation')

  if (!leagueId) return null
  if (!data) return <p className="text-[13px] text-[var(--zombie-text-dim)]">Loading the armory…</p>

  const chip = zombieChipStatus(data.teamStatus)
  const isZombie = chip === 'zombie'
  const isHuman = chip === 'survivor' || chip === 'revived'
  const reviveNeed = data.rules.reviveThreshold
  const canAct = !data.isCommissionerView
  const run = async (cmd: string) => {
    const ok = await sendCommand(cmd)
    if (ok) load()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-lime-300">The Armory</h1>
          <p className="text-[13px] text-white/60">
            {serums.length} serum{serums.length === 1 ? '' : 's'} · {held.length - serums.length} weapon
            {held.length - serums.length === 1 ? '' : 's'}
            {data.isCommissionerView ? ' · commissioner view of another manager' : ''}
          </p>
        </div>
        <ZombieStatusChip status={chip} size="md" />
      </header>

      {/* Serums — live */}
      <section className="rounded-2xl border border-teal-500/25 bg-teal-950/15 p-4 sm:p-5" data-testid="armory-serums">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
          <img src="/zombie/art/serum.svg" alt="" className="h-12 w-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-teal-100">Serums ×{serums.length}</h2>
            <p className="text-[13px] text-white/65">
              Max {data.rules.serumMaxHold}. One keeps you human for a week; {reviveNeed} bring a Zombie back.
            </p>
          </div>
        </div>

        {isZombie ? (
          <div className="mt-4">
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/55">Revive</p>
            <div className="mt-2 flex gap-1.5" aria-label={`${Math.min(serums.length, reviveNeed)} of ${reviveNeed} serums`}>
              {Array.from({ length: reviveNeed }).map((_, i) => (
                <span key={i} className={clsx('h-8 w-5 rounded-md border', i < serums.length ? 'border-lime-300 bg-lime-400' : 'border-lime-500/40')} />
              ))}
            </div>
            {canAct && serums.length >= reviveNeed ? (
              <button
                type="button"
                onClick={() => void run('@Chimmy revive')}
                disabled={isSending}
                className="mt-3 min-h-[48px] rounded-xl bg-amber-400 px-5 font-bold text-black disabled:opacity-50"
              >
                Revive — spend {reviveNeed} serums
              </button>
            ) : (
              <p className="mt-2 text-[13px] text-white/60">
                {Math.max(0, reviveNeed - serums.length)} more to come back as a Survivor.
              </p>
            )}
          </div>
        ) : null}

        {isHuman ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/55">Serum shield</p>
            {registered ? (
              <p className="mt-1 text-[13px] text-teal-100">
                Registered for week {registered.activatesAtWeek ?? '—'}. Lose to the horde that week and you stay human
                (the serum is spent); win and it comes back to you.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[13px] text-white/70">
                  Register one before kickoff: if you lose to a Zombie or the Whisperer that week, you stay human and the
                  serum is spent. If you win, you keep it.
                </p>
                {canAct && readySerums.length ? (
                  <button
                    type="button"
                    onClick={() => void run('@Chimmy use serum protect myself')}
                    disabled={isSending}
                    className="mt-3 min-h-[48px] rounded-xl bg-teal-500/30 px-5 font-semibold text-teal-50 hover:bg-teal-500/40 disabled:opacity-50"
                  >
                    Shield me this week
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {feedback ? (
          <p className={clsx('mt-3 text-[13px]', feedback.kind === 'success' ? 'text-emerald-200' : 'text-red-200')} role="status">
            {feedback.text}
          </p>
        ) : null}
      </section>

      {/* Defensive weapons — live in Enhanced Zombie */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" data-testid="armory-weapons">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-white">Weapons</h2>
          <p className="text-[12px] text-white/50">Earned automatically. In Enhanced Zombie, arm one before kickoff to block an eligible infection. Bomb effects are inactive.</p>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {weaponCatalog(data.rules).map((w) => {
            const count = held.filter((i) => i.itemType === w.type).length
            return (
              <li
                key={w.type}
                className={clsx('rounded-xl border p-3 text-center', count ? 'border-amber-400/40 bg-amber-500/[0.06]' : 'border-white/10 bg-black/20 opacity-70')}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
                <img src={`/zombie/art/${w.art}.svg`} alt="" className="mx-auto h-12 w-12" />
                <p className="mt-1 text-sm font-bold text-white">
                  {w.label} <span className="font-mono text-amber-300">×{count}</span>
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-white/55">{w.earn}</p>
                {w.type !== 'weapon_bomb' && isHuman && data.experienceMode !== 'simple' && canAct && !armedShield &&
                  held.some((item) => item.itemType === w.type && item.activationState === 'ready') ? (
                  <button
                    type="button"
                    onClick={() => void run(`@Chimmy use ${w.label.toLowerCase()}`)}
                    disabled={isSending}
                    className="mt-3 min-h-[44px] w-full rounded-lg border border-amber-300/50 bg-amber-300/15 px-2 text-[12px] font-semibold text-amber-100 disabled:opacity-50"
                  >
                    Arm {w.label}
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
        {armedShield && !isSerum(armedShield) ? (
          <p className="mt-3 text-[13px] text-amber-100" role="status">
            {armedShield.itemLabel} armed for week {armedShield.activatesAtWeek ?? '—'}. It is spent only if it blocks an infection.
          </p>
        ) : null}
      </section>

      {/* Ledger */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h2 className="text-lg font-bold text-white">Ledger</h2>
        {data.items.length === 0 ? (
          <p className="mt-2 text-[13px] text-white/55">Nothing earned yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {data.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="min-w-0 truncate text-white/85">
                  {i.itemLabel}
                  {i.acquiredReason ? <span className="text-white/45"> · {i.acquiredReason}</span> : null}
                </span>
                <span className="shrink-0 text-[12px] text-white/50">
                  {i.isUsed
                    ? `used${i.usedAtWeek ? ` week ${i.usedAtWeek}` : ''}`
                    : i.activationState === 'pending_activation'
                      ? `shield, week ${i.activatesAtWeek ?? '—'}`
                      : `held · ${new Date(i.acquiredAt).toLocaleDateString()}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setShowHistory((s) => !s)}
          className="mt-3 min-h-[40px] text-[12px] font-semibold text-white/60 underline"
        >
          {showHistory ? 'Hide' : 'Show'} @Chimmy actions
        </button>
        {showHistory ? (
          <ul className="mt-2 space-y-1 text-[12px] text-white/60">
            {data.history.length === 0 ? <li>None yet.</li> : null}
            {data.history.map((h) => (
              <li key={h.id}>
                {h.isValid ? '✓' : '✗'} Week {h.week} · {h.actionType} · {new Date(h.createdAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="text-center text-[12px] text-white/45">
        Serum and defensive weapon actions go through @Chimmy.{' '}
        <Link href={`/zombie/${leagueId}/rules`} className="text-lime-300 underline">
          Full rules
        </Link>
      </p>
    </div>
  )
}
