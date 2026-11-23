'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PartnerDashboard } from '@/lib/partner-codes/dashboard'
import { SHARE_FORMATS, SHARE_LOOKS, shareMessage, type ShareFormatKey, type ShareLookKey } from '@/lib/partner-codes/shareLooks'

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const n = (v: number) => v.toLocaleString('en-US')

const card = 'rounded-2xl border border-[#2a2f5a] bg-[#12163e] p-5 sm:p-6'
const label = 'text-xs font-semibold uppercase tracking-wider text-[#a3a8c9]'
const btn = 'inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold'
const btnPrimary = `${btn} bg-purple-500 text-white hover:bg-purple-400`
const btnGhost = `${btn} border border-[#3b3f6e] text-[#e8e9f5] hover:border-purple-400`

/** Commissioner Partner Codes — the commissioner's own page. Copy follows the canvas design. */
export function PartnerCodeDashboard({ initial, demo, imageBase = '/api/partner-codes/image' }: { initial: PartnerDashboard; demo: boolean; imageBase?: string }) {
  const [data, setData] = useState(initial)
  const s = data.settings
  const c = data.code

  const reload = useCallback(async () => {
    if (demo) return
    const res = await fetch('/api/partner-codes/me', { cache: 'no-store' })
    if (res.ok) setData(await res.json())
  }, [demo])

  return (
    <main className="min-h-dvh bg-[#0a0e1a] text-[#e8e9f5]">
      {demo || c?.isDemo ? (
        <div className="bg-[#3b1d5e] px-4 py-2 text-center text-[13px] font-semibold text-[#f3e8ff]">Demo · sample numbers so you can see how the Partner Code page works</div>
      ) : null}
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 sm:px-6">
        {!c ? (
          <ClaimCode onClaimed={reload} settings={s} />
        ) : (
          <>
            <Headline c={c} s={s} />
            <div className="grid gap-6 lg:grid-cols-2">
              <CodeCard c={c} s={s} demo={demo} onChanged={reload} />
              <Meters c={c} s={s} />
            </div>
            <Rewards c={c} s={s} />
            <Earnings c={c} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Mix c={c} />
              <Statements c={c} s={s} />
            </div>
            <ShareMaker c={c} demo={demo} imageBase={imageBase} />
          </>
        )}
      </div>
    </main>
  )
}

type S = PartnerDashboard['settings']
type C = NonNullable<PartnerDashboard['code']>

function Headline({ c, s }: { c: C; s: S }) {
  const toCash = Math.max(0, s.cashThresholdPaidSubs - c.paidSubs)
  const title = c.cashOn
    ? `You've earned ${money(c.earnings.thisMonthCents)} this month`
    : `${n(toCash)} more paid ${toCash === 1 ? 'subscriber' : 'subscribers'} to start earning ${s.commissionPercent}% cash`
  const sub = c.cashOn
    ? `${s.commissionPercent}% of what your ${n(c.paidSubs)} paid subscribers pay. Statements go out each month after review.`
    : c.freePlan !== 'none'
      ? `You already have ${c.freePlan === 'supreme' ? 'AF Supreme' : 'AF Commissioner'} free. Keep sharing your link.`
      : `Friends get ${s.discountPercent}% off their first ${s.discountMonths} months with your code.`
  return (
    <div>
      <h1 className="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
      <p className="mt-1.5 text-[#a3a8c9]">{sub}</p>
    </div>
  )
}

function ClaimCode({ onClaimed, settings }: { onClaimed: () => void; settings: S }) {
  const [value, setValue] = useState('')
  const [hint, setHint] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const v = value.trim()
    if (v.length < 4) { setHint(null); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/partner-codes/me?check=${encodeURIComponent(v)}`)
      const j = await res.json().catch(() => null)
      if (j) setHint({ ok: !!j.available, text: j.message })
    }, 300)
    return () => clearTimeout(t)
  }, [value])

  const claim = async () => {
    setBusy(true)
    const res = await fetch('/api/partner-codes/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: value }) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setHint({ ok: false, text: j.error ?? 'Could not save that code' }); return }
    onClaimed()
  }

  return (
    <section className={`${card} max-w-xl`} aria-labelledby="claim-h">
      <h1 id="claim-h" className="text-[28px] font-extrabold tracking-tight">Make your Partner Code</h1>
      <p className="mt-1.5 text-[#c7cbe6]">Friends who join with it get {settings.discountPercent}% off their first {settings.discountMonths} months. You unlock free plans, then {settings.commissionPercent}% cash, as your people join.</p>
      <label htmlFor="pc-code" className="mt-5 block text-sm font-bold">Your code</label>
      <input
        id="pc-code"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 20))}
        placeholder="TheCiege"
        aria-describedby="pc-code-help"
        className="mt-2 min-h-12 w-full rounded-xl border border-[#3b3f6e] bg-[#0a0e1a] px-4 text-lg font-extrabold text-white outline-none focus:border-purple-400"
      />
      <p id="pc-code-help" className={`mt-2 text-[13px] font-semibold ${hint ? (hint.ok ? 'text-emerald-400' : 'text-rose-300') : 'text-[#a3a8c9]'}`}>
        {hint?.text ?? 'Letters and numbers, 4–20. Shows the way you type it, works typed any way.'}
      </p>
      <button type="button" disabled={busy || !hint?.ok} onClick={claim} className={`${btnPrimary} mt-4 disabled:opacity-50`}>
        {busy ? 'Saving…' : 'Claim this code'}
      </button>
    </section>
  )
}

function CodeCard({ c, s, demo, onChanged }: { c: C; s: S; demo: boolean; onChanged: () => void }) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  // Same text on the server and the first client render (no hydration mismatch), then this site's origin.
  const [origin, setOrigin] = useState('https://allfantasy.ai')
  useEffect(() => setOrigin(window.location.origin), [])
  const url = `${origin}${c.joinPath}`
  const copy = async () => {
    await navigator.clipboard.writeText(shareMessage(c.code, url, s.discountPercent, s.discountMonths)).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <section className={`${card} flex flex-col gap-4`} aria-labelledby="code-h">
      <h2 id="code-h" className={label}>Your code</h2>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[34px] font-extrabold tracking-wide text-white">{c.code}</span>
        <span className="rounded-full bg-[#0f2e22] px-2.5 py-1 text-xs font-bold text-emerald-400">{c.status === 'active' ? 'Active' : c.status}</span>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-[#2a2f5a] bg-[#0a0e1a] py-1.5 pl-3.5 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-sm text-[#c7cbe6]">{url.replace(/^https?:\/\//, '')}</span>
        <button type="button" onClick={copy} className={btnPrimary}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <a href="#share-maker" className={btnGhost}>Make a share image</a>
        {!demo ? <button type="button" onClick={() => setEditing((v) => !v)} className={btnGhost}>Change code</button> : null}
      </div>
      {editing ? <ChangeCode current={c.code} onDone={() => { setEditing(false); onChanged() }} /> : null}
      <p className="text-[13px] text-[#a3a8c9]">Friends get {s.discountPercent}% off their first {s.discountMonths} months. Your old codes keep working if you change it.</p>
    </section>
  )
}

function ChangeCode({ current, onDone }: { current: string; onDone: () => void }) {
  const [value, setValue] = useState(current)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    const res = await fetch('/api/partner-codes/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: value }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(j.error ?? 'Could not change it'); return }
    onDone()
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-[#5b3a86] p-3">
      <label htmlFor="pc-change" className="text-sm font-bold">New code</label>
      <div className="flex gap-2">
        <input id="pc-change" value={value} onChange={(e) => setValue(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 20))} className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#3b3f6e] bg-[#0a0e1a] px-3 font-bold text-white" />
        <button type="button" onClick={save} className={btnPrimary}>Save</button>
      </div>
      {err ? <p className="text-[13px] text-rose-300">{err}</p> : <p className="text-[12px] text-[#a3a8c9]">You can change it twice a year.</p>}
    </div>
  )
}

function Bar({ value, max, pending, labelText }: { value: number; max: number; pending?: number; labelText: string }) {
  const pct = Math.min(100, (value / Math.max(1, max)) * 100)
  const pend = Math.min(100 - pct, ((pending ?? 0) / Math.max(1, max)) * 100)
  return (
    <div role="progressbar" aria-label={labelText} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="flex h-3.5 overflow-hidden rounded-full bg-[#0a0e1a]">
      <div className="bg-purple-500" style={{ width: `${pct}%` }} />
      {pend > 0 ? <div className="bg-[#5b3a86]" style={{ width: `${pend}%` }} /> : null}
    </div>
  )
}

function Meters({ c, s }: { c: C; s: S }) {
  return (
    <section className={`${card} flex flex-col gap-5`} aria-labelledby="meters-h">
      <h2 id="meters-h" className={label}>Your two meters</h2>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold">Paid subscribers</span>
          <span className="text-[#c7cbe6]"><strong className="text-xl text-white">{n(c.paidSubs)}</strong> {c.cashOn ? '· cash is on' : `of ${n(s.cashThresholdPaidSubs)} for cash`}</span>
        </div>
        <Bar value={c.paidSubs} max={s.cashThresholdPaidSubs} pending={c.pendingPaid} labelText={`Paid subscribers toward ${s.cashThresholdPaidSubs}`} />
        <p className="text-[13px] text-[#a3a8c9]">{c.pendingPaid ? `${n(c.pendingPaid)} more count once their first payment is 30 days old.` : 'A subscriber counts once their first payment is 30 days old.'}</p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold">Active users</span>
          <span className="text-[#c7cbe6]"><strong className="text-xl text-white">{n(c.activeUsers)}</strong> {c.activeUsers >= s.freeSupremeActiveUsers ? '· AF Supreme level' : `of ${n(s.freeSupremeActiveUsers)} for AF Supreme`}</span>
        </div>
        <Bar value={c.activeUsers} max={s.freeSupremeActiveUsers} labelText={`Active users toward ${s.freeSupremeActiveUsers}`} />
        <p className="text-[13px] text-[#a3a8c9]">Free or paid, anyone who joined with your code and opens AllFantasy on 4+ days a month.</p>
      </div>
    </section>
  )
}

function Rewards({ c, s }: { c: C; s: S }) {
  const rungs = [
    { at: `${s.freeCommissionerActiveUsers} active`, title: 'AF Commissioner free', on: c.freePlan === 'commissioner' || c.freePlan === 'supreme', body: `Held for ${s.rewardHoldDays} days.` },
    { at: `${s.freeSupremeActiveUsers} active`, title: 'AF Supreme free', on: c.freePlan === 'supreme', body: `Or ${s.freeSupremePaidSubs} paid subscribers.` },
    { at: `${s.cashThresholdPaidSubs} paid`, title: `${s.commissionPercent}% cash every month`, on: c.cashOn, body: 'Of what your subscribers pay, after fees.' },
  ]
  return (
    <section className={`${card} flex flex-col gap-4`} aria-labelledby="rewards-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="rewards-h" className="text-xl font-bold">Rewards you unlock</h2>
        <span className="text-[13px] text-[#a3a8c9]">Free plans stay on while you keep that many users</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {rungs.map((r) => (
          <li key={r.title} className={`flex flex-col gap-1.5 rounded-2xl border p-4 ${r.on ? 'border-violet-600 bg-[#24164a]' : 'border-[#2a2f5a] bg-[#0a0e1a]'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-extrabold text-white">{r.at}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${r.on ? 'bg-emerald-400 text-[#0f2e22]' : 'bg-[#1a1f3a] text-[#a3a8c9]'}`}>{r.on ? 'Unlocked' : 'Locked'}</span>
            </div>
            <span className="font-bold text-[#f3e8ff]">{r.title}</span>
            <span className="text-[13px] text-[#a3a8c9]">{r.body}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Earnings({ c }: { c: C }) {
  const stats = [
    { k: 'This month', v: money(c.earnings.thisMonthCents), note: c.cashOn ? 'Before refunds' : 'Starts when cash unlocks' },
    { k: 'Lifetime earned', v: money(c.earnings.lifetimeCents), note: 'All months' },
    { k: 'Paid to you', v: money(c.earnings.paidOutCents), note: `${c.payouts.filter((p) => p.status === 'paid').length} payouts` },
    { k: 'People who joined', v: n(c.signups), note: 'With your code' },
  ]
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Earnings">
      {stats.map((x) => (
        <div key={x.k} className={`${card} flex flex-col gap-1`}>
          <span className="text-[13px] text-[#a3a8c9]">{x.k}</span>
          <span className="text-[26px] font-extrabold text-white">{x.v}</span>
          <span className="text-xs text-[#a3a8c9]">{x.note}</span>
        </div>
      ))}
    </section>
  )
}

function Mix({ c }: { c: C }) {
  return (
    <section className={card} aria-labelledby="mix-h">
      <h2 id="mix-h" className="text-lg font-bold">Who's subscribed with your code</h2>
      {c.mix.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[#a3a8c9]"><th scope="col" className="py-2 font-semibold">Plan</th><th scope="col" className="py-2 text-right font-semibold">Monthly</th><th scope="col" className="py-2 text-right font-semibold">Yearly</th></tr></thead>
            <tbody>
              {c.mix.map((m) => (
                <tr key={m.plan} className="border-t border-[#23284d]"><th scope="row" className="py-3 text-left font-semibold">{m.plan}</th><td className="py-3 text-right">{n(m.month)}</td><td className="py-3 text-right">{n(m.year)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-[#c7cbe6]">No paid subscribers yet. Share your link in your league chat to get started.</p>
      )}
    </section>
  )
}

const PAYOUT_PILL: Record<string, string> = {
  paid: 'bg-[#0f2e22] text-emerald-400',
  approved: 'bg-[#1e2550] text-indigo-200',
  pending_review: 'bg-[#3a2a07] text-amber-300',
  held: 'bg-[#3f1515] text-rose-200',
}
const PAYOUT_LABEL: Record<string, string> = { paid: 'Paid', approved: 'Approved', pending_review: 'In review', held: 'Held' }

function Statements({ c, s }: { c: C; s: S }) {
  return (
    <section className={card} aria-labelledby="st-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="st-h" className="text-lg font-bold">Monthly statements</h2>
        <span className={`text-[13px] font-semibold ${c.taxFormStatus === 'missing' ? 'text-amber-300' : 'text-emerald-400'}`}>
          {c.taxFormStatus === 'missing' ? 'W-9 needed before payouts' : 'W-9 on file'}
        </span>
      </div>
      {c.payouts.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[#a3a8c9]"><th scope="col" className="py-2 font-semibold">Month</th><th scope="col" className="py-2 text-right font-semibold">Amount</th><th scope="col" className="py-2 text-right font-semibold">Status</th></tr></thead>
            <tbody>
              {c.payouts.map((p) => (
                <tr key={p.periodMonth} className="border-t border-[#23284d]">
                  <th scope="row" className="py-3 text-left font-medium">{p.periodMonth}</th>
                  <td className="py-3 text-right font-bold">{money(p.totalCents)}</td>
                  <td className="py-3 text-right"><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${PAYOUT_PILL[p.status] ?? ''}`}>{PAYOUT_LABEL[p.status] ?? p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-[#3b3f6e] bg-[#0a0e1a] p-4 text-[#c7cbe6]">
          Statements start the month after cash unlocks. Balances under {money(s.minPayoutCents)} roll over.
        </p>
      )}
    </section>
  )
}

function ShareMaker({ c, demo, imageBase }: { c: C; demo: boolean; imageBase: string }) {
  const [look, setLook] = useState<ShareLookKey>((c.shareLook in SHARE_LOOKS ? c.shareLook : 'midnight') as ShareLookKey)
  const [format, setFormat] = useState<ShareFormatKey>('story')
  const [name, setName] = useState(c.code)
  const src = useMemo(() => `${imageBase}?format=${format}&look=${look}&name=${encodeURIComponent(name)}${demo ? '&demo=1' : ''}`, [imageBase, format, look, name, demo])

  const pickLook = (k: ShareLookKey) => {
    setLook(k)
    if (!demo) void fetch('/api/partner-codes/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ look: k }) })
  }
  const pill = (on: boolean) => `${btn} gap-2 ${on ? 'border-2 border-purple-500 bg-[#2a1f4d] text-white' : 'border border-[#3b3f6e] text-[#c7cbe6]'}`
  const box = SHARE_FORMATS[format]
  const previewW = format === 'banner' ? 520 : format === 'square' ? 380 : 300

  return (
    <section id="share-maker" className={`${card} flex flex-col gap-6 lg:flex-row`} aria-labelledby="share-h">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <h2 id="share-h" className="text-xl font-bold">Make your share image</h2>
        <div className="flex flex-col gap-2">
          <label htmlFor="pc-name" className="text-sm font-bold">Name on the image</label>
          <input id="pc-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} className="min-h-12 rounded-xl border border-[#3b3f6e] bg-[#0a0e1a] px-3.5 text-white" />
        </div>
        <fieldset>
          <legend className="mb-2.5 text-sm font-bold">Look</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {(Object.keys(SHARE_LOOKS) as ShareLookKey[]).map((k) => (
              <button key={k} type="button" aria-pressed={look === k} onClick={() => pickLook(k)} className={pill(look === k)}>
                <span aria-hidden className="h-5 w-5 rounded-md border border-[#3b3f6e]" style={{ background: SHARE_LOOKS[k].bg, boxShadow: `inset -7px 0 0 ${SHARE_LOOKS[k].accent}` }} />
                {SHARE_LOOKS[k].label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2.5 text-sm font-bold">Size</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SHARE_FORMATS) as ShareFormatKey[]).map((k) => (
              <button key={k} type="button" aria-pressed={format === k} onClick={() => setFormat(k)} className={pill(format === k)}>{SHARE_FORMATS[k].label}</button>
            ))}
          </div>
        </fieldset>
        <p className="text-[12px] text-[#a3a8c9]">Uploading your own logo is coming next. Every share includes: “I get rewards when you join with my code.”</p>
      </div>
      <div className="flex flex-1 flex-col items-center gap-4 rounded-2xl bg-[#0a0e1a] p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Share image with code ${c.code}`} width={previewW} height={Math.round((previewW * box.height) / box.width)} className="rounded-xl shadow-2xl" />
        <div className="flex flex-wrap justify-center gap-2.5">
          <a href={src} download={`allfantasy-${c.code}-${format}.png`} className={btnPrimary}>Download image</a>
        </div>
      </div>
    </section>
  )
}
