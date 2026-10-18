'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ZombieTurnMoment } from './types'

/*
 * Infection night (the handoff's ZombieTurn): shown once over the Zombie home after a resolved week that
 * changed your status — you turned, you survived an infected opponent, or you came back. Every line is
 * what the engine does; nothing here promises a shield, weapon effects or locked items.
 *
 * "Once" is per viewer and per moment (`moment.key`), remembered in localStorage. If storage is
 * unavailable it shows again next visit, which is the safe failure.
 */

const SEEN_KEY = (leagueId: string) => `af_zombie_turn_seen_${leagueId}`

function readSeen(leagueId: string): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY(leagueId))
  } catch {
    return null
  }
}

function markSeen(leagueId: string, key: string) {
  try {
    window.localStorage.setItem(SEEN_KEY(leagueId), key)
  } catch {
    /* private mode / blocked storage: it may show again, never breaks */
  }
}

const fmt = (n: number | null) => (n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }))

export type ZombieTurnContext = {
  reviveSerums: number
  serums: number
  lossToZombieInfects: boolean
  zombieTradeBlocked: boolean
}

/**
 * Share the moment as text — the device's share sheet, else the clipboard. No image card: those are
 * rendered by dedicated share routes, and this repo adds no API routes. The link is the league page, which
 * only members can open; it never carries an invite code. Returns what happened.
 */
export async function shareMoment(
  moment: ZombieTurnMoment,
  leagueId: string,
  leagueName?: string | null,
): Promise<'shared' | 'copied' | 'failed'> {
  const where = leagueName ? ` in ${leagueName}` : ''
  const text = {
    turned: `I turned in week ${moment.week}${where}. The horde grows. 🧟`,
    survived: `Still human after week ${moment.week}${where}. 🧍`,
    revived: `Back from the dead${where}. 🧪`,
  }[moment.kind]
  const url = `${window.location.origin}/league/${encodeURIComponent(leagueId)}`
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: 'Zombie league', text, url })
      return 'shared'
    }
    await navigator.clipboard.writeText(`${text} ${url}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export function ZombieTurnOverlay({
  leagueId,
  leagueName,
  moment,
  ctx,
}: {
  leagueId: string
  leagueName?: string | null
  moment: ZombieTurnMoment | null | undefined
  ctx: ZombieTurnContext
}) {
  const [open, setOpen] = useState(false)
  const [shared, setShared] = useState<'shared' | 'copied' | 'failed' | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (moment && readSeen(leagueId) !== moment.key) setOpen(true)
  }, [leagueId, moment])

  const close = useCallback(() => {
    if (moment) markSeen(leagueId, moment.key)
    setOpen(false)
  }, [leagueId, moment])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open || !moment) return null

  const opp = moment.opponentName
  const score = `${fmt(moment.opponentScore)} to ${fmt(moment.myScore)}`
  const copy = {
    turned: {
      art: 'char-zombie',
      title: 'You turned',
      tone: 'text-lime-300',
      line: opp
        ? `${opp} got you, ${score}. You're a Zombie now.`
        : `The infection got you, ${score}. You're a Zombie now.`,
      steps: [
        ctx.lossToZombieInfects
          ? 'Beat a Survivor and they turn too.'
          : "In this league only the Whisperer's bite spreads. Your wins still count.",
        `Your week's Outbreak Points went to ${opp ?? 'whoever turned you'}.`,
        `Collect ${ctx.reviveSerums} serums to come back as a Survivor — you have ${ctx.serums}.`,
        `You keep your roster and your points.${ctx.zombieTradeBlocked ? " Zombies can't trade." : ''}`,
      ],
    },
    survived: {
      art: 'char-survivor',
      title: 'You survived',
      tone: 'text-sky-300',
      line: `You beat ${opp ?? 'the horde'}, ${fmt(moment.myScore)} to ${fmt(moment.opponentScore)}. Still human.`,
      steps: ['Every win against the horde keeps you human.', 'Win by the bash line and you also take a share of their week.'],
    },
    revived: {
      art: 'char-revived',
      title: "You're back",
      tone: 'text-amber-300',
      line: "The serums worked. You're a Survivor again.",
      steps: ['Lose to an infected team and you can turn again.', 'Your roster and points came with you.'],
    },
  }[moment.kind]

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="zombie-turn-title"
      data-testid="zombie-turn-overlay"
    >
      <div className="zombie-enter relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0d14] p-6 text-center shadow-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Infection night · week {moment.week}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
        <img src={`/zombie/art/${copy.art}.svg`} alt="" className="zombie-float mx-auto mt-4 h-36 w-36" />
        {moment.kind === 'turned' ? (
          <ol className="mt-3 flex justify-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" aria-label="Survivor, bitten, turning, Zombie">
            {['Survivor', 'Bitten', 'Turning', 'Zombie'].map((s, i) => (
              <li key={s} className={i === 3 ? 'rounded-full bg-lime-500/20 px-2 py-0.5 text-lime-200' : 'rounded-full bg-white/5 px-2 py-0.5 text-white/50'}>
                {s}
              </li>
            ))}
          </ol>
        ) : null}
        <h2 id="zombie-turn-title" className={`mt-4 text-4xl font-black uppercase tracking-tight ${copy.tone}`}>
          {copy.title}
        </h2>
        <p className="mt-2 text-[15px] text-white/80">{copy.line}</p>
        <ol className="mt-5 space-y-2 text-left text-[13px] text-white/75">
          {copy.steps.map((s, i) => (
            <li key={s} className="flex gap-2.5">
              <span className="font-mono font-bold text-lime-300">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="min-h-[44px] rounded-xl bg-lime-400 px-5 font-bold text-black hover:bg-lime-300"
          >
            {moment.kind === 'turned' ? 'Join the horde' : 'Back to the outbreak'}
          </button>
          <button
            type="button"
            onClick={() => void shareMoment(moment, leagueId, leagueName).then(setShared)}
            className="min-h-[44px] rounded-xl border border-white/20 bg-white/[0.06] px-5 font-semibold text-white hover:bg-white/10"
          >
            {shared === 'copied' ? 'Copied' : 'Share this'}
          </button>
        </div>
      </div>
    </div>
  )
}
