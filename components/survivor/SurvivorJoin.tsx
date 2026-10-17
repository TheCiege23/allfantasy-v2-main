'use client'

import Link from 'next/link'

export type SurvivorJoinPreview = {
  castSize: number
  joined: number
  inviter: string
  season: number | string | null
  draftAt: string | null
  tribeCount: number
  tribes: Array<{ name: string; logoUrl: string | null; managerCount: number }>
  idolCount: number
  mergeWeek: number
  exileEnabled: boolean
  exileReturnTokens: number
  councilDay: string
  councilTime: string
  tieRule: string
}

type Props = {
  leagueName: string
  sport: string
  survivor: SurvivorJoinPreview
  authStatus: string
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

const STEPS = [
  { title: 'Join a tribe', art: '/survivor/weekly/torch-lit.svg', detail: 'The league fills first. Then the system draws tribes at random.' },
  { title: 'Win immunity', art: '/survivor/weekly/immunity-necklace.svg', detail: 'Your weekly NBA scoring powers tribe and individual challenges.' },
  { title: 'Cast a private vote', art: '/survivor/weekly/urn.svg', detail: 'Message @Chimmy with your pick. The tally stays sealed until the Torch Ceremony.' },
  { title: 'Discover an idol', art: '/survivor/idols/immunity.svg', detail: 'Hidden powers follow real players you draft, trade, or claim.' },
  { title: 'Fight back from Exile', art: '/survivor/exile/token-coin.svg', detail: 'Voted off? Build a separate weekly roster and compete for return tokens.' },
  { title: 'Face the jury', art: '/survivor/late/champion-trophy.svg', detail: 'After the merge, survive the final votes to reach the season finale.' },
] as const

function dateLabel(value: string | null): string {
  if (!value) return 'To be announced'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'To be announced'
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(date) + ' ET'
}

export function SurvivorJoin(props: Props) {
  const { survivor } = props
  const filled = Math.max(0, Math.min(survivor.castSize, survivor.joined))
  const full = filled >= survivor.castSize
  const signIn = props.authStatus === 'unauthenticated' || props.needsSignIn
  const settings = [
    ['Sport and season', `${props.sport} ${survivor.season ?? ''}`.trim()],
    ['Weekly scoring', 'Tuesday through Monday'],
    ['Cast and tribes', `${survivor.castSize} managers · ${survivor.tribeCount} tribes`],
    ['Draft', dateLabel(survivor.draftAt)],
    ['Vote read', `${survivor.councilDay} · ${survivor.councilTime} league time`],
    ['Ties', survivor.tieRule],
    ['Merge', `Week ${survivor.mergeWeek}`],
    ['Exile', survivor.exileEnabled ? `Enabled · ${survivor.exileReturnTokens} tokens to qualify` : 'Off'],
  ]

  return <main className="min-h-screen bg-[#07080d] text-[#e8eaf2]" data-testid="survivor-join">
    <section className="relative overflow-hidden border-b border-white/10 bg-[url('/survivor/backgrounds/dusk-basketball.svg')] bg-cover bg-center px-5 py-12 sm:px-8 lg:px-12">
      <div className="absolute inset-0 bg-gradient-to-r from-[#07080d]/80 via-[#07080d]/30 to-[#07080d]/50" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_360px] lg:items-start">
        <div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold text-white/80">
            {[`${props.sport} ${survivor.season ?? ''}`.trim(), `${survivor.castSize} managers`, `${survivor.tribeCount} tribes`, `${survivor.idolCount} hidden idols`].map(chip => <span key={chip} className="rounded-md border border-white/20 bg-black/40 px-2 py-1">{chip}</span>)}
          </div>
          <h1 className="mt-5 font-serif text-4xl font-bold uppercase tracking-wide text-white sm:text-6xl">{props.leagueName}</h1>
          <p className="mt-4 text-base text-slate-200">You&apos;re invited by {survivor.inviter}. Outscore, outvote, outlast.</p>
        </div>
        <div className="rounded-2xl border border-amber-400/40 bg-[#0b0d14]/90 p-6 shadow-2xl">
          <p className="text-3xl font-bold tabular-nums">{filled} <span className="text-base font-normal text-slate-300">of {survivor.castSize} spots filled</span></p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="League spots filled" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={survivor.castSize}><div className="h-full bg-amber-400" style={{ width: `${100 * filled / Math.max(1, survivor.castSize)}%` }} /></div>
          <p className="mt-4 text-sm text-slate-300">Draft {dateLabel(survivor.draftAt)}. Your tribe is drawn after the league fills.</p>
          {props.status === 'success' ? <div className="mt-5 rounded-xl border border-emerald-400/40 bg-emerald-950/40 p-4" role="status"><strong>You&apos;re in. Your torch is lit.</strong><p className="mt-1 text-sm text-slate-200">Opening your league…</p>{props.joinedLeagueId ? <Link className="mt-2 inline-block underline" href={`/league/${props.joinedLeagueId}`}>Open league now</Link> : null}</div> : signIn ? <div className="mt-5 grid gap-2"><Link href={`/signup?callbackUrl=${encodeURIComponent(props.callbackUrl)}`} className="rounded-xl bg-amber-400 px-5 py-3 text-center font-bold text-[#1b1509]">Create account and join</Link><Link href={`/login?callbackUrl=${encodeURIComponent(props.callbackUrl)}`} className="rounded-xl border border-white/20 px-5 py-3 text-center font-semibold">Sign in to join</Link></div> : <div className="mt-5 grid gap-3">{props.requiresPassword ? <label className="text-sm">League password<input type="password" value={props.password} onChange={event => props.onPasswordChange(event.target.value)} className="mt-2 w-full rounded-xl border border-white/20 bg-black/50 px-3 py-2 text-white" /></label> : null}<button type="button" onClick={props.onJoin} disabled={props.status === 'joining' || full} className="min-h-12 rounded-xl bg-amber-400 px-5 py-3 font-bold text-[#1b1509] disabled:cursor-not-allowed disabled:opacity-50">{props.status === 'joining' ? 'Joining…' : full ? 'Island full' : 'Join the island'}</button></div>}
          {props.status === 'error' ? <p className="mt-3 text-sm text-red-300" role="alert">{props.message}</p> : null}
        </div>
      </div>
    </section>
    <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-12">
      <h2 className="font-serif text-3xl font-bold">How Survivor works</h2>
      <p className="mt-1 text-sm text-slate-400">A season in six steps</p>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{STEPS.map((step, index) => <article key={step.title} className="rounded-xl border border-white/10 bg-[#10121b] p-4 text-center"><p className="text-xs font-bold uppercase tracking-widest text-amber-400">Step {index + 1}</p><img src={step.art} alt="" className="mx-auto mt-4 h-20 w-20 object-contain" /><h3 className="mt-3 font-serif text-lg font-bold text-amber-200">{step.title}</h3><p className="mt-2 text-sm leading-5 text-slate-400">{step.detail}</p></article>)}</div>
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-white/10 bg-[#10121b] p-5"><h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">League settings</h2><dl className="mt-4">{settings.map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-t border-white/10 py-2 text-sm"><dt className="text-slate-400">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}</dl></section>
        <section className="rounded-xl border border-white/10 bg-[#10121b] p-5"><h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Who&apos;s on the island</h2><p className="mt-4 text-3xl font-bold tabular-nums">{filled} / {survivor.castSize}</p><p className="mt-2 text-sm text-slate-400">{survivor.castSize - filled} spots remain. Manager names appear in the league after you join.</p></section>
        <section className="rounded-xl border border-white/10 bg-[#10121b] p-5"><h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">The tribes</h2><div className="mt-4 grid grid-cols-2 gap-2">{survivor.tribes.map(tribe => <div key={tribe.name} className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-center">{tribe.logoUrl ? <img src={tribe.logoUrl} alt="" className="mx-auto h-12 w-12 object-contain" /> : null}<p className="mt-1 font-semibold">{tribe.name}</p><p className="text-xs text-slate-400">{tribe.managerCount} spots</p></div>)}</div><p className="mt-3 text-xs text-slate-400">Tribes are assigned at random when the league fills. Your tribe remains hidden until then.</p><p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-100">{survivor.idolCount} idols will be hidden on drafted players. Nobody knows where, including a commissioner who plays.</p></section>
      </div>
    </div>
  </main>
}
