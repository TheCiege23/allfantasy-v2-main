'use client'

import Link from 'next/link'
import { useState } from 'react'
import '@/components/core-app/af-landing.css'

/**
 * The B2B band is built and kept, but off the public landing page.
 *
 * AllFantasy is not selling the business offer yet, and `/` is the B2C
 * acquisition surface: a player arriving from search should meet "connect your
 * leagues", not "run Decision OS over your own league data". Shipping both on
 * one page buries the consumer pitch under an enterprise one.
 *
 * Nothing is deleted. Flip this to true to restore the band, the "For business"
 * nav item and the Partners chip together — they hang off this one constant so
 * they cannot return half-wired. Both nav items are in-page links to #business,
 * so neither may render while the band does not: they would be dead anchors.
 *
 * A real /for-business route is the better long-term home, and is deliberately
 * NOT done here: this repo sits at Vercel's hard 2048-route ceiling, where
 * going over yields a broken deployment that still builds green locally.
 */
const SHOW_B2B = false

/**
 * Landing page — the "landing, auth & import" handoff.
 *
 * Token values in that handoff are byte-identical to the core-app one, so this
 * reuses the `.af-core` scope rather than duplicating a second copy that would
 * drift. See af-core.css for why the scope exists at all.
 *
 * MOUNTED AT `/` — app/page.tsx renders this component, so it carries the SEO
 * and every acquisition link. (This note previously claimed the opposite; it
 * was left behind when the cut-over happened.)
 *
 * ⚠ THE B2B BAND SELLS "WE RUN DECISION OS AND CHIMMY OVER YOUR DATA" — a business
 * connects its own league data and we return decisions and signals, through their
 * surface or ours. It is NOT "send your users to our consumer app". Keep that
 * distinction when editing: the two readings are different products, and copy
 * neutral enough to mean either lets a reader book a call for the wrong one.
 *
 * It previously described
 * "the cross-platform layer, as an API" with a partner sign-in button and a
 * "sandbox keys same day" note — none of which exist: there is no partner surface
 * in this codebase and nothing issues a sandbox key. Every capability now listed is
 * something that ships and runs, and the single CTA is the one thing this page can
 * actually deliver: a demo request that is stored and emailed. See DemoForm.
 */

const PLATFORMS = [
  { name: 'Sleeper', state: 'live' as const },
  { name: 'ESPN', state: 'live' as const },
  { name: 'Yahoo', state: 'live' as const },
  { name: 'MFL · Fantrax', state: 'soon' as const },
]

const REASONS = [
  {
    n: '01',
    title: ['All your leagues,', 'one board.'],
    body: 'Sleeper, ESPN and Yahoo, with your real rosters and history. One Sunday view instead of four tabs.',
  },
  {
    n: '02',
    title: ['One player,', 'every league.'],
    body: 'Search a name and see every team you have him on, his injury status, and the swap or waiver that follows in each one.',
  },
  {
    n: '03',
    title: ['Know what', 'needs you.'],
    body: 'Unset lineups, waiver runs, trades on the clock — each tagged with the league and the deadline it belongs to.',
  },
]

const FAQ = [
  {
    q: 'Can I import my Sleeper, ESPN and Yahoo leagues?',
    a: 'Yes — read-only. We copy your real rosters, matchups and scoring, and never change anything on the platform.',
  },
  {
    q: 'How does the cross-league player finder work?',
    a: 'Search a player once and see every league you roster him in, his slot and injury status, and what to do about him in each.',
  },
  {
    q: 'Is AllFantasy gambling or DFS?',
    a: 'No. AllFantasy is 100% season-long fantasy sports. No sportsbook, no daily fantasy.',
  },
  {
    q: 'What does it cost?',
    a: 'Free forever for players. Paid plans run $9.99–$29.99/mo and can be cancelled anytime.',
  },
]

/*
 * ⚠ EVERY CAPABILITY BELOW IS SOMETHING THAT EXISTS AND RUNS. Written from the
 * live route map and the shipped programs, not from a wish list: the Decision OS
 * surfaces are the four deterministic routes in docs/decision-os, manager
 * psychology shipped to production, and Chimmy is the live assistant with its
 * freshness contract. A business band is the worst place to describe a roadmap as
 * a product — the reader books a call on the strength of it.
 */
/*
 * ⚠ THE OFFER IS "WE RUN THIS OVER YOUR DATA", NOT "YOUR USERS SIGN UP FOR OURS".
 * Every line is written from the buyer's side of that boundary — their leagues,
 * their users, their surface — because the two readings imply completely
 * different products and an earlier draft was neutral enough to be read either
 * way. Neutral copy is not safe copy here: it lets a reader book a call for the
 * thing we are not selling.
 *
 * ⚠ EVERY CAPABILITY MAPS TO SOMETHING THAT SHIPS — the four deterministic
 * Decision OS routes, the manager-psychology program live in production, and
 * Chimmy's league-scoped answers with their freshness contract. A business band
 * is the worst place to describe a roadmap as a product: the reader books a call
 * on the strength of it.
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

const NETWORK = [
  { name: 'Gooby', body: 'Social discovery for people and their dogs.', href: 'https://gogooby.com' },
  { name: 'Cafe Con Chimmy', body: 'Culture, coffee and conversation from the Chimmy world.', href: 'https://cafeconchimmy.com' },
  { name: 'Parent Playbook', body: 'Practical plays for parents, one situation at a time.', href: 'https://playbook.chimaura.com' },
  { name: 'PetPass', body: 'Every pet record, vet visit and reminder in one pass.', href: 'https://petpass.chimaura.com' },
  { name: 'SideQuest', body: 'Turn the side hustle into a tracked, finishable quest.', href: 'https://sidequest.chimaura.com' },
  { name: 'StoryVault', body: 'Record and keep the family stories before they are gone.', href: 'https://storyvault.chimaura.com' },
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

function Shield() {
  return (
    <svg width="28" height="30" viewBox="0 0 28 30" aria-hidden focusable="false">
      <path
        d="M14 1.5 26 6v10.5c0 6.4-5 10.6-12 12.5-7-1.9-12-6.1-12-12.5V6l12-4.5Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text
        x="14"
        y="19"
        textAnchor="middle"
        fill="var(--accent)"
        style={{ font: '900 10px Archivo, sans-serif', letterSpacing: '0.02em' }}
      >
        AF
      </text>
    </svg>
  )
}

export function LandingV4() {
  return (
    <div className="af-core af-lp">
      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <nav className="af-lp-nav" aria-label="Main">
        <Link href="/" className="af-lp-brand">
          <Shield />
          <span className="af-lp-wordmark">AllFantasy</span>
        </Link>

        <div className="af-lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">For commissioners</a>
          {/* Accent-coloured in the handoff because it is the only nav item
              aimed at another audience. Gated with the band it points at. */}
          {SHOW_B2B ? (
            <a href="#business" className="af-lp-nav-business">
              For business
            </a>
          ) : null}
        </div>

        <div className="af-lp-nav-right">
          <Link href="/login">Sign in</Link>
          {/* Divider and Partners both belong to the B2B band: Partners is an
              in-page link to #business, so it is a dead anchor without it, and
              the divider would then separate nothing. */}
          {SHOW_B2B ? (
            <>
              <span className="af-lp-nav-divider" aria-hidden />
              <a href="#business" className="af-lp-partners">
                Partners
                <span className="af-lp-api-chip af-num">DEMO</span>
              </a>
            </>
          ) : null}
          <Link href="/signup" className="af-btn af-lp-cta">
            Get started free
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <header className="af-lp-hero" id="how">
        <div className="af-lp-hero-text">
          <span className="af-lp-eyebrow af-num">Fantasy sports only · no gambling</span>
          <h1 className="af-lp-h1">
            Every league you play.
            <br />
            <span className="af-lp-h1-accent">One screen.</span>
          </h1>
          <p className="af-lp-sub">
            Connect Sleeper, ESPN and Yahoo. See what needs you across every league, and exactly
            where to go and fix it.
          </p>
          <div className="af-lp-hero-ctas">
            <Link href="/signup" className="af-btn af-lp-cta-lg">
              Get started free
            </Link>
            <a href="#how" className="af-btn af-btn--ghost af-lp-cta-lg">
              See how it works
            </a>
          </div>
          <p className="af-lp-reassure">
            Free forever for players · Read-only · Cancel anytime
          </p>
        </div>

        {/*
          The hero card is illustrative, and labelled as such. It shows the shape
          of the product with example leagues — not a live reading — so it must
          not be mistaken for someone's actual data.
        */}
        <aside className="af-lp-hero-card" aria-label="Example of the leagues view">
          <div className="af-lp-card-head">
            <span className="af-lp-card-title">Your leagues</span>
            <span className="af-lp-card-week af-num">Week 12 · example</span>
          </div>
          {[
            { mark: 'S', platform: 'sleeper', name: 'Dynasty Dragons', meta: 'Sleeper · Dynasty PPR', score: '96.2', against: '–88.4', tag: 'Set flex', tone: 'bad' },
            { mark: 'E', platform: 'espn', name: 'Gridiron Gang', meta: 'ESPN · 0.5 PPR', score: '74.0', against: '–91.6', tag: 'Waivers', tone: 'warn' },
            { mark: 'Y', platform: 'yahoo', name: 'Waiver Warriors', meta: 'Yahoo · Standard', score: '110.8', against: '–102.1', tag: 'Trade', tone: 'warn' },
            { mark: 'E', platform: 'espn', name: 'End Zone Elites', meta: 'ESPN · Keeper', score: '88.4', against: '–71.9', tag: 'All set', tone: 'good' },
          ].map((row) => (
            <div key={row.name} className="af-lp-card-row">
              <span className="af-platform af-lp-card-mark" data-platform={row.platform}>
                {row.mark}
              </span>
              <span className="af-lp-card-text">
                <span className="af-lp-card-name">{row.name}</span>
                <span className="af-lp-card-meta">{row.meta}</span>
              </span>
              <span className="af-lp-card-score af-num">
                {row.score}
                <span className="af-lp-card-against">{row.against}</span>
              </span>
              <span className="af-lp-card-tag af-num" data-tone={row.tone}>
                {row.tag}
              </span>
            </div>
          ))}
          <div className="af-lp-card-foot">
            <span className="af-lp-card-foot-text">
              Two fixes worth <strong>+13.0</strong> — Chimmy, across all 4 leagues
            </span>
          </div>
        </aside>
      </header>

      {/* ── Connects to ─────────────────────────────────────────────── */}
      <section className="af-lp-connects">
        <span className="af-label">Connects to</span>
        <div className="af-lp-connect-row">
          {PLATFORMS.map((p) => (
            <span key={p.name} className="af-lp-connect" data-state={p.state}>
              {p.name}
              {p.state === 'soon' ? <span className="af-lp-soon af-num">soon</span> : null}
            </span>
          ))}
        </div>
        <span className="af-lp-sports af-num">NFL · NBA · NHL · MLB · NCAA · SOCCER</span>
      </section>

      {/* ── Three reasons ───────────────────────────────────────────── */}
      <section className="af-lp-reasons">
        <h2 className="af-lp-h2">Three things you can&apos;t do anywhere else</h2>
        <div className="af-lp-reason-grid">
          {REASONS.map((r) => (
            <article key={r.n} className="af-lp-reason">
              <span className="af-lp-reason-n af-num">{r.n}</span>
              <h3 className="af-lp-reason-title">
                {r.title[0]}
                <br />
                {r.title[1]}
              </h3>
              <p className="af-lp-reason-body">{r.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Pricing line ────────────────────────────────────────────── */}
      <section className="af-lp-pricing" id="pricing">
        <h2 className="af-lp-h2">Free to see it all. Upgrade to act on it.</h2>
        <p className="af-lp-pricing-body">
          Every league, live score and standing is free. Paid plans from $9.99/mo add trade grades,
          projections and commissioner tools.
        </p>
        <div className="af-lp-pricing-ctas">
          <Link href="/signup" className="af-btn">
            Start free
          </Link>
          <Link href="/pricing" className="af-btn af-btn--ghost">
            Compare plans
          </Link>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <section className="af-lp-faq" id="faq">
        <h2 className="af-lp-h2">Questions managers ask</h2>
        <div className="af-lp-faq-list">
          {FAQ.map((f) => (
            <details key={f.q} className="af-lp-faq-item">
              <summary className="af-lp-faq-q">{f.q}</summary>
              <p className="af-lp-faq-a">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── AllFantasy for Business ─────────────────────────────────── */}
      {SHOW_B2B ? (
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
      ) : null}

      {/* ── Brown Pig network ───────────────────────────────────────── */}
      <section className="af-lp-network">
        <span className="af-label">From Brown Pig LLC</span>
        <h2 className="af-lp-h2">Apps that solve real problems</h2>
        <p className="af-lp-network-body">
          AllFantasy is one of six products we build and run. One account family, same standard.
        </p>
        <div className="af-lp-network-grid">
          {NETWORK.map((n) => (
            <a key={n.name} href={n.href} className="af-lp-network-card" target="_blank" rel="noopener noreferrer">
              <span className="af-lp-network-name">{n.name}</span>
              <span className="af-lp-network-desc">{n.body}</span>
              <span className="af-lp-network-link af-num">
                {n.href.replace(/^https?:\/\//, '')} →
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="af-lp-footer">
        <div className="af-lp-footer-top">
          <span className="af-lp-brand">
            <Shield />
            <span className="af-lp-wordmark">AllFantasy</span>
          </span>
          <nav className="af-lp-footer-links" aria-label="Footer">
            <Link href="/core/players">Player finder</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/data-deletion">Data deletion</Link>
          </nav>
        </div>
        <div className="af-lp-footer-legal">
          <span>© 2026 AllFantasy.ai</span>
          <span className="af-label">Built by Brown Pig LLC</span>
        </div>
        {/*
          Jurisdiction copy is a compliance statement, not decoration — it stays
          in the footer verbatim.
        */}
        <p className="af-lp-footer-compliance">
          Not available in WA. Paid leagues restricted in HI, ID, MT, NV. 100% fantasy sports — no
          gambling, no DFS.
        </p>
      </footer>
    </div>
  )
}

export default LandingV4
