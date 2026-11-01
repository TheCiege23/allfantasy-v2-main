'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ZombieSceneBackground } from './ZombieSceneBackground'
import type { ZombieJoinPreview } from '@/lib/zombie/zombieJoinPreview'

export type { ZombieJoinPreview }

type Props = {
  leagueName: string
  sport: string
  zombie: ZombieJoinPreview
  authStatus: 'authenticated' | 'unauthenticated' | 'loading'
  needsSignIn: boolean
  callbackUrl: string
  requiresPassword: boolean
  password: string
  onPasswordChange: (value: string) => void
  onJoin: () => void
  status: 'idle' | 'joining' | 'success' | 'error'
  message: string
  joinedLeagueId: string | null
}

const pct = (share: number) => `${Math.round(share * 100)}%`

/**
 * The invite page for a Zombie league — the existing `/join?code=` route, dressed for the variant the way
 * `SurvivorJoin` dresses a Survivor league. Every number is the engine's (`getZombieRulesForSport`).
 * `/join/[token]` uses the hero and how-it-works around its own team picker.
 */
export function ZombieJoin(props: Props) {
  const z = props.zombie
  const signIn = props.authStatus === 'unauthenticated' || props.needsSignIn
  const full = z.joined >= z.teamCount
  const open = Math.max(0, z.teamCount - z.joined)

  return (
    <main className="min-h-screen bg-[#07080d] text-white" data-testid="zombie-join">
      <ZombieJoinHero leagueName={props.leagueName} sport={props.sport} zombie={z}>
        {props.status === 'success' ? (
          <div className="rounded-xl border border-lime-400/40 bg-lime-950/40 p-4" role="status">
            <strong>You&apos;re in. Stay human.</strong>
            <p className="mt-1 text-sm text-white/75">Opening your league…</p>
            {props.joinedLeagueId ? (
              <Link className="mt-2 inline-block underline" href={`/league/${props.joinedLeagueId}`}>
                Open league now
              </Link>
            ) : null}
          </div>
        ) : signIn ? (
          <div className="grid gap-2">
            <Link
              href={`/signup?callbackUrl=${encodeURIComponent(props.callbackUrl)}`}
              className="rounded-xl bg-lime-400 px-5 py-3 text-center font-bold text-black"
            >
              Create account and join
            </Link>
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(props.callbackUrl)}`}
              className="rounded-xl border border-white/20 bg-black/40 px-5 py-3 text-center font-semibold"
            >
              Sign in to join
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {props.requiresPassword ? (
              <label className="text-sm">
                League password
                <input
                  type="password"
                  value={props.password}
                  onChange={(event) => props.onPasswordChange(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/20 bg-black/50 px-3 py-2 text-white"
                />
              </label>
            ) : null}
            <button
              type="button"
              onClick={props.onJoin}
              disabled={props.status === 'joining' || full}
              data-testid="league-join-button"
              className="min-h-12 rounded-xl bg-lime-400 px-5 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.status === 'joining' ? 'Joining…' : full ? 'League full' : `Join the outbreak${open ? ` · ${open} spot${open === 1 ? '' : 's'} left` : ''}`}
            </button>
          </div>
        )}
        {props.status === 'error' ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {props.message}
          </p>
        ) : null}
      </ZombieJoinHero>
      <ZombieHowItWorks zombie={z} />
    </main>
  )
}

/** The scene hero of a Zombie invite: who invited you, the league, the pitch. `children` is the action area. */
export function ZombieJoinHero({
  leagueName,
  sport,
  zombie: z,
  children,
}: {
  leagueName: string
  sport: string
  zombie: ZombieJoinPreview
  children?: ReactNode
}) {
  const draft = z.draftAt ? new Date(z.draftAt) : null
  return (
    <section className="relative overflow-hidden" data-testid="zombie-join-hero">
      <ZombieSceneBackground themeId={z.backgroundTheme} />
      <div className="relative z-[1] mx-auto max-w-3xl px-4 pb-10 pt-12 sm:pt-16">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-lime-300">{z.inviter} invited you</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-lime-300 sm:text-5xl">{leagueName}</h1>
        <p className="mt-2 text-sm text-white/75">
          {sport} Zombie league{z.season ? ` · ${z.season}` : ''} · {z.joined} of {z.teamCount} joined
          {draft && !Number.isNaN(draft.getTime())
            ? ` · draft ${draft.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
            : ''}
        </p>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/85">
          Whisperers lead the outbreak. A loss can turn you. Survive the season — or lead the horde.
        </p>
        {children ? <div className="mt-6 max-w-md">{children}</div> : null}
      </div>
    </section>
  )
}

/** The four-step how-it-works, with the engine's numbers. */
export function ZombieHowItWorks({ zombie: z }: { zombie: ZombieJoinPreview }) {
  const steps: [string, string, string][] = [
    ['char-survivor', 'Start as a Survivor', `Managers start as Survivors or ${z.whispererSecret ? 'secret ' : ''}Whisperers.`],
    [
      'turn',
      'Lose and you might turn',
      z.lossToZombieInfects
        ? 'Lose to the Whisperer or a Zombie and you join the horde. Zombies keep playing.'
        : 'Lose to the Whisperer and you join the horde. Zombies keep playing.',
    ],
    [
      'maul',
      'Every point counts',
      'Survivor wins earn 2, 4 or 6 winnings units by opponent. Zombies and Whisperers can take accumulated winnings. Bashings and maulings can take all the loser holds.',
    ],
    ['serum', 'Come back', `Collect ${z.reviveSerums} serums and a Zombie returns as a Survivor.`],
  ]
  return (
    <section className="mx-auto max-w-3xl px-4 pb-16">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">How it works</h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-2">
        {steps.map(([art, title, body], i) => (
          <li key={title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
            <img src={`/zombie/art/${art}.svg`} alt="" className="h-10 w-10 shrink-0" />
            <div>
              <p className="font-bold">
                <span className="mr-1.5 font-mono text-lime-300">{i + 1}</span>
                {title}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-white/65">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
