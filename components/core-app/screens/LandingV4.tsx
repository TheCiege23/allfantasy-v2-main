'use client'

import Link from 'next/link'
import { useState } from 'react'
// af-core.css carries the .af-core token layer (--surface, --line, --accent …).
// AfCoreShell imports it for every screen inside the shell — but this one renders
// standalone at `/`, so without this line every `var(--surface)` and `var(--line)`
// below resolves to nothing: cards paint transparent with a 0px border, and
// --accent falls through to the unrelated #2563eb in app/globals.css. Verified on
// the live page before this fix: --surface, --surface2 and --line all computed to
// the empty string. Must precede af-landing.css so tokens exist before use.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-landing.css'

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
 * The B2B band and its demo form now live in Partners.tsx, served at
 * /core/partners. This page is B2C only.
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
const NETWORK = [
  { name: 'Gooby', body: 'Social discovery for people and their dogs.', href: 'https://gogooby.com' },
  { name: 'Cafe Con Chimmy', body: 'Culture, coffee and conversation from the Chimmy world.', href: 'https://cafeconchimmy.com' },
  { name: 'Parent Playbook', body: 'Practical plays for parents, one situation at a time.', href: 'https://playbook.chimaura.com' },
  { name: 'PetPass', body: 'Every pet record, vet visit and reminder in one pass.', href: 'https://petpass.chimaura.com' },
  { name: 'SideQuest', body: 'Turn the side hustle into a tracked, finishable quest.', href: 'https://sidequest.chimaura.com' },
  { name: 'StoryVault', body: 'Record and keep the family stories before they are gone.', href: 'https://storyvault.chimaura.com' },
]

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
        </div>

        <div className="af-lp-nav-right">
          <Link href="/login">Sign in</Link>
          {/* Partners points at the B2B screen, which is served by the
              /core catch-all as the `partners` segment — no extra route. It was
              previously an in-page #business anchor, which became a dead link
              when the band moved off this page. */}
          <span className="af-lp-nav-divider" aria-hidden />
          <Link href="/core/partners" className="af-lp-partners">
            Partners
            <span className="af-lp-api-chip af-num">API</span>
          </Link>
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

      {/* ── Brown Pig network ───────────────────────────────────────── */}
      <section className="af-lp-network">
        {/*
          The parent mark. public/brand/brown-pig-llc.png has been in the repo the
          whole time and nothing referenced it — the section rendered its heading
          and six cards with no logo at all, which is why the page had ZERO images
          on it. Plain <img>, not next/image: this is a static local asset in a
          server component and the optimiser buys nothing at this size.
        */}
        <div className="af-lp-network-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="af-lp-network-mark"
            src="/brand/brown-pig-llc.png"
            alt="Brown Pig LLC"
            width={72}
            height={72}
            loading="lazy"
          />
          <div>
            <span className="af-label">From Brown Pig LLC</span>
            <h2 className="af-lp-h2">Apps that solve real problems</h2>
        <p className="af-lp-network-body">
          AllFantasy is one of six products we build and run. One account family, same standard.
            </p>
          </div>
        </div>
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
          <span className="af-lp-footer-builtby">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="af-lp-footer-mark"
              src="/brand/brown-pig-llc.png"
              alt=""
              width={34}
              height={34}
              loading="lazy"
            />
            <span className="af-lp-footer-builtby-text">
              <span className="af-label">Built by</span>
              <strong className="af-lp-footer-builtby-name">Brown Pig LLC</strong>
            </span>
          </span>
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
