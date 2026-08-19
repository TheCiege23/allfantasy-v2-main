'use client'

import Link from 'next/link'
import { useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-landing.css'

/**
 * AllFantasy for Business — the B2B offer, on its own screen.
 *
 * Lifted verbatim out of LandingV4. `/` is the B2C acquisition surface: a player
 * arriving from search should meet "connect your leagues", not "run Decision OS
 * over your own league data", so the band moved here rather than sitting below
 * the consumer pitch.
 *
 * ⚠ NO NEW ROUTE. The repo sits at Vercel's hard 2048-route ceiling, where going
 * over yields a deployment that fails while still building green locally. This
 * screen is served by the existing `/core/[[...screen]]` catch-all as the
 * `partners` segment — the same way landing-preview and the auth previews are —
 * so it costs zero additional routes. It is dispatched BEFORE the session gate
 * and outside AfCoreShell, because a marketing page exists for people who are
 * NOT signed in and has its own nav.
 *
 * ⚠ THIS SELLS "WE RUN DECISION OS AND CHIMMY OVER YOUR DATA" — a business
 * connects its own league data and we return decisions and signals, through their
 * surface or ours. It is NOT "send your users to our consumer app". Keep that
 * distinction when editing: the two readings are different products, and copy
 * neutral enough to mean either lets a reader book a call for the wrong one.
 */

const CAPABILITIES = [
  {
    key: 'DECISION OS',
    title: 'Decisions on your leagues',
    body: 'Point us at your league data and get back the call and its reasoning — lineups, trades, waivers, playoff paths — resolved against each league’s own settings, not a global ranking.',
  },
  {
    key: 'MANAGER PSYCHOLOGY',
    title: 'How your users actually play',
    body: 'Trade, draft and lineup patterns read from your leagues’ real history and scored against each league’s own peers: who overpays, who never streams, who disengages in November.',
  },
  {
    key: 'CHIMMY INTELLIGENCE',
    title: 'A conversational layer over it',
    body: 'Answers drawn from your league data, carrying how fresh that data is, so a reply can never quietly outrun what it knows. Runs behind your product or ours.',
  },
  {
    key: 'THE LAYER UNDER IT',
    title: 'However your data arrives',
    body: 'The hard part is not the data — it is that every platform models a league differently. We already reconcile six of them, so the engines above do not care what shape yours is in.',
  },
]

const AUDIENCES = [
  { who: 'Fantasy platforms', why: 'Decision intelligence on your own leagues, without building a model team.' },
  { who: 'Media & creators', why: 'Manager psychology and storylines drawn from the leagues you cover.' },
  { who: 'League operators', why: 'Health, engagement and attention signals across every league you run.' },
  { who: 'Brands & agencies', why: 'Season-long activations grounded in real league behaviour.' },
]

/**
 * Demo request — POSTs to /api/early-access with `kind: 'business-demo'`.
 *
 * ⚠ THIS REPLACED A `mailto:` FORM. That composed a message in whatever mail
 * client the visitor happened to have configured, which on a work laptop is
 * frequently none — the button appeared to do nothing and the lead was gone. It
 * now stores a row AND sends a notification, and the endpoint is built so a
 * database failure still delivers the email rather than losing the request.
 *
 * ⚠ NO NEW ROUTE. The repo sits at Vercel's hard 2048-route ceiling, so this
 * folds into the existing public lead-capture endpoint as a separate branch.
 */
function DemoForm() {
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [useCase, setUseCase] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Enter a work email so we can reach you.')
      return
    }
    setState('sending')
    try {
      const res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'business-demo',
          email: email.trim(),
          company: company.trim() || undefined,
          useCase: useCase.trim() || undefined,
          referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        // The endpoint only fails when BOTH the row and the email failed, i.e.
        // when the request really was lost — so its wording is worth surfacing
        // rather than replacing with something reassuring.
        setError(data.error || 'We could not send that. Please try again.')
        setState('idle')
        return
      }
      setState('sent')
    } catch {
      setError('We could not send that. Please check your connection and try again.')
      setState('idle')
    }
  }

  if (state === 'sent') {
    return (
      <div className="af-lp-demo" id="demo">
        <span className="af-label">Request received</span>
        {/*
          Says what happens next and by when. "Thanks!" leaves the reader unsure
          whether anything was actually recorded.
        */}
        <p className="af-lp-demo-body">
          Thanks — we have your request and will reply to <strong>{email.trim()}</strong> within one
          business day to book a time.
        </p>
      </div>
    )
  }

  return (
    <form className="af-lp-demo" id="demo" onSubmit={onSubmit} noValidate>
      <span className="af-label">Request a demo</span>
      <p className="af-lp-demo-body">
        Thirty minutes, walked through Decision OS and Chimmy running on data like yours.
      </p>
      <label className="af-lp-field">
        <span className="af-label">Work email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="af-lp-field">
        <span className="af-label">Company</span>
        <input
          type="text"
          name="company"
          autoComplete="organization"
          placeholder="Company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </label>
      <label className="af-lp-field">
        <span className="af-label">Your leagues and what you&apos;d want back</span>
        <textarea
          name="useCase"
          rows={3}
          placeholder="Where your league data lives, and what you'd want it to answer"
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
        />
      </label>
      {error ? (
        <p className="af-lp-demo-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="af-btn af-lp-demo-submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Request a demo'}
      </button>
    </form>
  )
}

export function Partners() {
  return (
    <div className="af-core af-lp">
      <nav className="af-lp-nav" aria-label="Main">
        <Link href="/" className="af-lp-brand">
          <span className="af-lp-wordmark">AllFantasy</span>
        </Link>
        <div className="af-lp-nav-right">
          <Link href="/">Back to AllFantasy</Link>
          <span className="af-lp-nav-divider" aria-hidden />
          <Link href="/signup" className="af-btn af-lp-cta">
            Get started free
          </Link>
        </div>
      </nav>

        <section className="af-lp-b2b" id="business">
        <div className="af-lp-b2b-head">
          <div className="af-lp-b2b-intro">
            <span className="af-lp-eyebrow af-num af-lp-eyebrow--accent">AllFantasy for business</span>
            <h2 className="af-lp-b2b-h2">Run Decision OS and Chimmy over your own league data</h2>
            <p className="af-lp-b2b-body">
              Connect your leagues and we return the decisions and the behavioural signals behind
              them — through your product or ours. Your users never have to leave your platform, and
              you don&apos;t have to build a model team to get there.
            </p>
          </div>

          <div className="af-lp-b2b-cta">
            <a href="#demo" className="af-btn af-lp-b2b-btn">
              Request a demo
            </a>
            {/*
              ⚠ NO SECOND CTA HERE ON PURPOSE. This band previously carried a
              "Partner sign in" button next to a "Sandbox keys same day" note.
              Neither exists: there is no partner surface in this codebase and
              nothing issues a sandbox key, so both were promises the next click
              would break. One ask, and it is one this page can actually keep.
            */}
            <span className="af-lp-b2b-note">A walkthrough on your leagues · no commitment</span>
          </div>
        </div>

        <div className="af-lp-cap-grid">
          {CAPABILITIES.map((c) => (
            <article key={c.key} className="af-lp-cap">
              <span className="af-label af-lp-cap-key">{c.key}</span>
              <h3 className="af-lp-cap-title">{c.title}</h3>
              <p className="af-lp-cap-body">{c.body}</p>
            </article>
          ))}
        </div>

        <div className="af-lp-b2b-bottom">
          <div className="af-lp-audience">
            <span className="af-label">Who this is for</span>
            <ul className="af-lp-audience-list">
              {AUDIENCES.map((a) => (
                <li key={a.who}>
                  <span className="af-lp-audience-who">{a.who}</span>
                  <span className="af-lp-audience-why">{a.why}</span>
                </li>
              ))}
            </ul>
            {/*
              ⚠ REWRITTEN FOR THE "WE RUN IT OVER YOUR DATA" MODEL. The previous
              wording was the consumer promise verbatim, which answers the wrong
              question: a platform handing over its users' league history wants to
              know what happens to that data, not that we won't post to Sleeper.
              It states the operating boundary and says plainly that the terms are
              a conversation — inventing retention or processing commitments the
              business has not actually made would be the worst thing this band
              could do.
            */}
            <p className="af-lp-boundary">
              <span className="af-readonly">Read-only</span>
              We operate read-only on whatever you connect, and it stays your data — used to answer
              for your leagues, not resold. Season-long fantasy only: no gambling, no DFS, and we
              never act on a user&apos;s behalf. Processing and retention terms are part of the
              conversation, not fine print.
            </p>
          </div>

          <DemoForm />
        </div>
      </section>
    </div>
  )
}

export default Partners
