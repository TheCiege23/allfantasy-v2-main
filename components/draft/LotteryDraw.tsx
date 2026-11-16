'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { draftLotteryMessages } from '@/lib/core-app/messages/draftLottery'
import {
  formatOdds,
  formatRecord,
  movementFor,
  oddsBarPercent,
  projectedSlots,
  revealSequence,
  stillIn,
  worstFirst,
  type LotteryDraw as LotteryDrawRow,
  type LotteryOddsTeam,
  type SlotEntry,
} from '@/lib/draft-lottery/lotteryView'

type LotteryResult = {
  lotteryDraws: LotteryDrawRow[]
  slotOrder: SlotEntry[]
  seed: string
  runAt?: string
}

type Loaded = {
  leagueName: string | null
  currentUserRosterId: string | null
  eligible: LotteryOddsTeam[]
  pickCount: number
  teamCount: number
}

type Phase = 'odds' | 'reveal' | 'order'

function asResult(raw: unknown): LotteryResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.lotteryDraws) || !Array.isArray(r.slotOrder) || typeof r.seed !== 'string') return null
  return { lotteryDraws: r.lotteryDraws as LotteryDrawRow[], slotOrder: r.slotOrder as SlotEntry[], seed: r.seed, runAt: typeof r.runAt === 'string' ? r.runAt : undefined }
}

/**
 * The draft lottery: odds before the draw, a pick-by-pick reveal (last pick first), the final order
 * with each team's movement, and the commissioner's lock-in.
 *
 * Only the commissioner can run or lock the lottery (POST /lottery/run is commissioner-only), so
 * members never see those controls — they see the odds and then the locked order. Running is a
 * preview (`finalize: false`); locking re-runs with the SAME seed and `finalize: true`, which the
 * seeded engine reproduces exactly, then the response's order is what we show.
 */
export function LotteryDraw({ draftId, isCommissioner = false }: { draftId: string; isCommissioner?: boolean }) {
  const m = useMessages(draftLotteryMessages)
  const { language } = useOptionalLanguage()
  const locale = language === 'es' ? 'es-US' : 'en-US'

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [result, setResult] = useState<LotteryResult | null>(null)
  const [locked, setLocked] = useState(false)
  const [phase, setPhase] = useState<Phase>('odds')
  const [revealMode, setRevealMode] = useState<'sequential' | 'all'>('sequential')
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState<'run' | 'lock' | null>(null)
  const [actionError, setActionError] = useState<'run' | 'lock' | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/draft/${encodeURIComponent(draftId)}/state`, { cache: 'no-store' }).catch(() => null)
      const data = res?.ok ? await res.json().catch(() => null) : null
      if (cancelled) return
      if (!data) {
        setLoadError(true)
        return
      }
      const eligible: LotteryOddsTeam[] = Array.isArray(data.lotteryPreview?.eligible) ? data.lotteryPreview.eligible : []
      const state = data.state ?? {}
      setLoaded({
        leagueName: typeof state.leagueName === 'string' ? state.leagueName : null,
        currentUserRosterId: typeof state.currentUserRosterId === 'string' ? state.currentUserRosterId : null,
        eligible,
        pickCount: Number.isFinite(data.lottery?.pickCount) ? Number(data.lottery.pickCount) : eligible.length,
        teamCount: Number.isFinite(state.teamCount) ? Number(state.teamCount) : eligible.length,
      })
      const last = asResult(data.lottery?.lastResult)
      if (data.lottery?.locked && last) {
        setResult(last)
        setLocked(true)
        setPhase('order')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [draftId])

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<LotteryResult | null> => {
      const res = await fetch(`/api/draft/${encodeURIComponent(draftId)}/lottery/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null)
      return res?.ok ? asResult(await res.json().catch(() => null)) : null
    },
    [draftId],
  )

  const run = async () => {
    setBusy('run')
    setActionError(null)
    const next = await post({ finalize: false })
    setBusy(null)
    if (!next) {
      setActionError('run')
      return
    }
    setResult(next)
    if (revealMode === 'sequential' && next.lotteryDraws.length > 0) {
      setStep(1)
      setPhase('reveal')
    } else {
      setPhase('order')
    }
  }

  const lock = async () => {
    if (!result) return
    setBusy('lock')
    setActionError(null)
    const finalResult = await post({ finalize: true, seed: result.seed })
    setBusy(null)
    if (!finalResult) {
      setActionError('lock')
      return
    }
    setResult(finalResult)
    setLocked(true)
  }

  const projected = useMemo(() => projectedSlots(loaded?.eligible ?? []), [loaded?.eligible])
  const oddsById = useMemo(() => new Map((loaded?.eligible ?? []).map((t) => [t.rosterId, t])), [loaded?.eligible])

  if (loadError) return <p className="rounded-2xl border border-white/10 bg-[#0b1426] p-5 text-sm text-white/75" role="alert">{m.loadFailed}</p>
  if (!loaded) return <p className="rounded-2xl border border-white/10 bg-[#0b1426] p-5 text-sm text-white/60">{m.loading}</p>

  const me = loaded.currentUserRosterId
  const pickCount = Math.max(1, Math.min(loaded.pickCount, loaded.eligible.length || loaded.pickCount))
  const header = (
    <header className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
        {loaded.leagueName ? m.eyebrow(loaded.leagueName) : m.eyebrowNoLeague}
      </p>
      <h1 className="text-3xl font-extrabold leading-tight text-white sm:text-4xl">{phase === 'order' ? m.orderTitle : m.title}</h1>
      <p className="max-w-3xl text-sm leading-relaxed text-white/70 sm:text-[15px]">
        {phase === 'order'
          ? m.orderBody
          : `${m.rulesDrawn(loaded.eligible.length, pickCount)}${loaded.teamCount > pickCount ? ` ${m.rulesRest(pickCount + 1, loaded.teamCount)}` : ''}`}
      </p>
    </header>
  )

  // ── Odds (before the draw) ────────────────────────────────────────────────
  if (phase === 'odds') {
    if (loaded.eligible.length === 0) {
      return (
        <div className="space-y-5" data-testid="lottery-page">
          {header}
          <p className="rounded-2xl border border-white/10 bg-[#0b1426] p-5 text-sm text-white/75" role="status">{m.noTeams}</p>
        </div>
      )
    }
    const ordered = worstFirst(loaded.eligible)
    return (
      <div className="space-y-5" data-testid="lottery-page">
        {header}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <section aria-label={m.oddsAria} className="rounded-2xl border border-white/10 bg-[#0b1426] p-3 sm:p-4" data-testid="lottery-odds">
            <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-3 pb-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/50 sm:grid-cols-[52px_minmax(0,1fr)_64px_minmax(140px,220px)]">
              <span>{m.colRank}</span>
              <span>{m.colTeam}</span>
              <span className="hidden sm:block">{m.colRecord}</span>
              <span className="text-right sm:text-left">{m.colOdds}</span>
            </div>
            <ol className="flex flex-col gap-1">
              {ordered.map((team) => {
                const mine = me != null && team.rosterId === me
                const record = formatRecord(team)
                return (
                  <li
                    key={team.rosterId}
                    className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2.5 sm:grid-cols-[52px_minmax(0,1fr)_64px_minmax(140px,220px)] ${
                      mine ? 'bg-[#0c2030] shadow-[inset_0_0_0_1px_#22d3ee]' : ''
                    }`}
                    data-testid={`lottery-odds-row-${team.rosterId}`}
                  >
                    <span className={`text-sm font-bold ${mine ? 'text-cyan-300' : 'text-white/55'}`}>{m.rank(team.rank)}</span>
                    <span className="min-w-0 truncate text-sm font-bold text-white">
                      {team.displayName}
                      {mine ? <span className="ml-1 text-xs font-semibold text-cyan-300">· {m.you}</span> : null}
                    </span>
                    <span className="hidden text-sm text-white/70 sm:block">{record ?? '—'}</span>
                    <span className="flex items-center justify-end gap-2.5 sm:justify-start">
                      <span className="hidden h-2.5 flex-1 overflow-hidden rounded-full bg-[#15223a] sm:block" aria-hidden>
                        <span className="block h-full rounded-full bg-cyan-400" style={{ width: `${oddsBarPercent(team.oddsPercent, loaded.eligible)}%` }} />
                      </span>
                      <b className="w-14 text-right text-sm text-white">{formatOdds(team.oddsPercent)}</b>
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>

          {isCommissioner ? (
            <section aria-label={m.runTitle} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0b1426] p-4 sm:p-5" data-testid="lottery-run-panel">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-amber-300">{m.commissioner}</span>
              <span className="text-lg font-extrabold text-white">{m.runTitle}</span>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm text-white/70">{m.revealLegend}</legend>
                {(['sequential', 'all'] as const).map((mode) => (
                  <label key={mode} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 px-3 text-sm text-white">
                    <input
                      type="radio"
                      name="lottery-reveal-mode"
                      value={mode}
                      checked={revealMode === mode}
                      onChange={() => setRevealMode(mode)}
                      className="h-4 w-4 accent-cyan-400"
                      data-testid={`lottery-reveal-mode-${mode}`}
                    />
                    {mode === 'sequential' ? m.revealOneByOne : m.revealAll}
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy === 'run'}
                className="min-h-[48px] rounded-xl bg-cyan-400 text-[15px] font-extrabold text-[#04121a] hover:bg-cyan-300 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                data-testid="lottery-run-button"
              >
                {busy === 'run' ? m.running : m.runButton}
              </button>
              {actionError === 'run' ? <p className="text-sm text-red-300" role="alert">{m.runFailed}</p> : null}
              <p className="text-[13px] text-white/55">{m.notFinal}</p>
            </section>
          ) : (
            <section className="flex flex-col gap-2 rounded-2xl border border-dashed border-white/15 p-4 sm:p-5" role="status" data-testid="lottery-waiting">
              <span className="text-lg font-extrabold text-white">{m.waitingTitle}</span>
              <span className="text-sm text-white/70">{m.waitingBody}</span>
            </section>
          )}
        </div>
      </div>
    )
  }

  if (!result) return null

  // ── Reveal, one pick at a time ────────────────────────────────────────────
  if (phase === 'reveal') {
    const sequence = revealSequence(result.lotteryDraws)
    const shown = sequence.slice(0, step)
    const current = shown[shown.length - 1]
    const nextDraw = sequence[step]
    const remaining = stillIn(loaded.eligible, shown)
    const move = movementFor(current.rosterId, current.pickSlot, projected)
    const currentOdds = oddsById.get(current.rosterId)
    const meStillIn = me != null && remaining.some((t) => t.rosterId === me)
    return (
      <div className="space-y-5" data-testid="lottery-page">
        {header}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-stretch">
          <section
            aria-label={m.revealAria}
            aria-live="polite"
            className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 px-5 py-8 text-center lg:min-h-[520px]"
            style={{ background: 'radial-gradient(circle at 50% 25%, rgba(34,211,238,0.13), transparent 60%), #0b1426' }}
            data-testid="lottery-reveal-stage"
          >
            <span className="font-mono text-sm font-extrabold tracking-[0.2em] text-cyan-300">{m.pickLabel(current.pickSlot)}</span>
            <span className="text-3xl font-extrabold leading-none text-white sm:text-5xl" data-testid="lottery-reveal-team">{current.displayName}</span>
            <span
              className={`rounded-full border px-3.5 py-1.5 text-sm font-bold ${
                move.direction === 'up'
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                  : move.direction === 'down'
                    ? 'border-rose-400/40 bg-rose-400/10 text-rose-300'
                    : 'border-white/15 bg-white/[0.04] text-white/70'
              }`}
            >
              {move.direction === 'up' && move.from != null
                ? m.movedUp(move.by, move.from)
                : move.direction === 'down' && move.from != null
                  ? m.movedDown(move.by, move.from)
                  : m.asProjected}
            </span>
            {currentOdds ? <span className="text-sm text-white/55">{m.hadOdds(formatRecord(currentOdds) ?? '', formatOdds(currentOdds.oddsPercent))}</span> : null}
            <button
              type="button"
              onClick={() => (nextDraw ? setStep((s) => s + 1) : setPhase('order'))}
              className="mt-4 min-h-[52px] rounded-2xl bg-cyan-400 px-7 text-base font-extrabold text-[#04121a] hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
              data-testid="lottery-reveal-next"
            >
              {nextDraw ? m.revealNext(nextDraw.pickSlot) : m.showOrder}
            </button>
            <span className="max-w-md text-[13px] text-white/50">{m.pace}</span>
          </section>

          <div className="flex flex-col gap-3.5">
            {remaining.length > 0 && nextDraw ? (
              <section className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#0b1426] p-4" data-testid="lottery-still-in">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-amber-300">
                  {m.stillInTitle(1, nextDraw.pickSlot)}
                </span>
                {remaining.map((team) => {
                  const mine = me != null && team.rosterId === me
                  return (
                    <div
                      key={team.rosterId}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${mine ? 'border-cyan-400 bg-[#0c2030]' : 'border-white/10 bg-[#0f192d]'}`}
                    >
                      <span className="min-w-0 truncate font-bold text-white">
                        {team.displayName}
                        {mine ? <span className="ml-1 text-xs font-semibold text-cyan-300">· {m.you}</span> : null}
                      </span>
                      <span className="shrink-0 text-white/65">{formatOdds(team.oddsPercent)}</span>
                    </div>
                  )
                })}
                {meStillIn && remaining.length <= nextDraw.pickSlot ? (
                  <span className="text-sm font-bold text-cyan-200">{m.youGuaranteed(nextDraw.pickSlot)}</span>
                ) : null}
              </section>
            ) : null}
            <section className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-[#0b1426] p-4" data-testid="lottery-revealed">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/50">{m.revealed}</span>
              {shown
                .slice()
                .reverse()
                .map((draw, i) => {
                  const mv = movementFor(draw.rosterId, draw.pickSlot, projected)
                  return (
                    <div
                      key={draw.pickSlot}
                      className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl bg-[#0f192d] px-3.5 py-2 text-sm ${i === 0 ? 'shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]' : ''}`}
                    >
                      <span className={`font-mono font-extrabold ${i === 0 ? 'text-cyan-300' : 'text-white/50'}`}>{draw.pickSlot}</span>
                      <span className="min-w-0 truncate font-bold text-white">{draw.displayName}</span>
                      <span className={`text-xs font-bold ${mv.direction === 'up' ? 'text-emerald-300' : mv.direction === 'down' ? 'text-rose-300' : 'text-white/45'}`}>
                        {mv.direction === 'up' ? m.shortUp(mv.by) : mv.direction === 'down' ? m.shortDown(mv.by) : '—'}
                      </span>
                    </div>
                  )
                })}
            </section>
          </div>
        </div>
      </div>
    )
  }

  // ── Final order ───────────────────────────────────────────────────────────
  const drawBySlot = new Map(result.lotteryDraws.map((d) => [d.pickSlot, d]))
  const order = result.slotOrder.slice().sort((a, b) => a.slot - b.slot)
  const lotteryRows = order.filter((e) => drawBySlot.has(e.slot))
  const standingsRows = order.filter((e) => !drawBySlot.has(e.slot))
  const mySlot = me != null ? order.find((e) => e.rosterId === me) ?? null : null
  const myMove = mySlot && drawBySlot.has(mySlot.slot) ? movementFor(me as string, mySlot.slot, projected) : null
  const myOdds = me != null ? oddsById.get(me) : undefined
  const drawnAt = result.runAt ? new Date(result.runAt) : null

  return (
    <div className="space-y-5" data-testid="lottery-page">
      {header}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <section aria-label={m.orderAria} className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-[#0b1426] p-3 sm:p-4" data-testid="lottery-order">
          <ol className="flex flex-col gap-1">
            {lotteryRows.map((entry) => {
              const mine = me != null && entry.rosterId === me
              const mv = movementFor(entry.rosterId, entry.slot, projected)
              return (
                <li
                  key={entry.slot}
                  className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm ${mine ? 'bg-[#0c2030] shadow-[inset_0_0_0_1px_#22d3ee]' : 'bg-[#0f192d]'}`}
                  data-testid={`lottery-order-row-${entry.slot}`}
                >
                  <span className={`font-mono font-extrabold ${mine ? 'text-cyan-300' : 'text-white/50'}`}>{entry.slot}</span>
                  <span className="min-w-0 truncate font-bold text-white">
                    {entry.displayName}
                    {mine ? <span className="ml-1 text-xs font-semibold text-cyan-300">· {m.you}</span> : null}
                  </span>
                  <span className={`text-xs font-bold ${mv.direction === 'up' ? 'text-emerald-300' : mv.direction === 'down' ? 'text-rose-300' : 'text-white/45'}`}>
                    {mv.direction === 'up' && mv.from != null
                      ? m.moveUpLong(mv.by, m.ordinal(mv.from))
                      : mv.direction === 'down' && mv.from != null
                        ? m.moveDownLong(mv.by, m.ordinal(mv.from))
                        : m.asProjectedShort}
                  </span>
                </li>
              )
            })}
          </ol>
          {standingsRows.length ? (
            <>
              <span className="mx-1 mt-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/50">{m.byStandings}</span>
              <ol className="flex flex-col gap-1" start={standingsRows[0].slot}>
                {standingsRows.map((entry) => {
                  const mine = me != null && entry.rosterId === me
                  return (
                    <li
                      key={entry.slot}
                      className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-xl px-3.5 py-2 text-sm ${mine ? 'bg-[#0c2030] shadow-[inset_0_0_0_1px_#22d3ee]' : ''}`}
                      data-testid={`lottery-order-row-${entry.slot}`}
                    >
                      <span className="font-mono font-extrabold text-white/50">{entry.slot}</span>
                      <span className="min-w-0 truncate text-white/80">
                        {entry.displayName}
                        {mine ? <span className="ml-1 text-xs font-semibold text-cyan-300">· {m.you}</span> : null}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </>
          ) : null}
        </section>

        <div className="flex flex-col gap-3.5">
          {mySlot ? (
            <section
              className="flex flex-col gap-1.5 rounded-2xl border border-cyan-400 p-4 sm:p-5"
              style={{ background: 'radial-gradient(circle at 20% 0%, rgba(34,211,238,0.18), transparent 70%), #0b1426' }}
              data-testid="lottery-you"
            >
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-cyan-300">{m.you}</span>
              <span className="text-xl font-extrabold text-white">{myMove ? m.youGot(mySlot.slot) : m.youStandings(m.ordinal(mySlot.slot))}</span>
              {myMove ? (
                <span className="text-sm text-white/70">
                  {myMove.direction === 'up' && myMove.from != null
                    ? m.youUp(m.ordinal(myMove.from), myOdds ? formatOdds(myOdds.oddsPercent) : null)
                    : myMove.direction === 'down' && myMove.from != null
                      ? m.youDown(m.ordinal(myMove.from))
                      : m.youSame}
                </span>
              ) : null}
            </section>
          ) : null}

          {locked ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-emerald-400/40 bg-[#0b1426] p-4 sm:p-5" data-testid="lottery-locked">
              <span className="text-lg font-extrabold text-white">{m.lockedTitle}</span>
              <span className="text-sm text-white/70">{m.lockedBody}</span>
              <Link
                href={`/drafts/${encodeURIComponent(draftId)}`}
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-cyan-400 px-5 text-[15px] font-extrabold text-[#04121a] hover:bg-cyan-300"
                data-testid="lottery-open-board"
              >
                {m.openBoard}
              </Link>
            </section>
          ) : isCommissioner ? (
            <section aria-label={m.lockTitle} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0b1426] p-4 sm:p-5" data-testid="lottery-lock-panel">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-amber-300">{m.commissioner}</span>
              <span className="text-lg font-extrabold text-white">{m.lockTitle}</span>
              <span className="text-sm leading-snug text-white/70">{m.lockBody}</span>
              <button
                type="button"
                onClick={() => void lock()}
                disabled={busy === 'lock'}
                className="min-h-[48px] rounded-xl bg-cyan-400 text-[15px] font-extrabold text-[#04121a] hover:bg-cyan-300 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                data-testid="lottery-lock-button"
              >
                {busy === 'lock' ? m.locking : m.lockButton}
              </button>
              {actionError === 'lock' ? <p className="text-sm text-red-300" role="alert">{m.lockFailed}</p> : null}
              {drawnAt && Number.isFinite(drawnAt.getTime()) ? (
                <span className="text-xs text-white/45">
                  {m.audit(new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(drawnAt), result.seed.slice(-8))}
                </span>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
