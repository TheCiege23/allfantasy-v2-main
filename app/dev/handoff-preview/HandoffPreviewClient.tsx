'use client'

import Link from 'next/link'
import { useState } from 'react'
import LeagueTile from '@/components/core-app/league-tile/LeagueTile'
import { findCollidingNames } from '@/components/core-app/league-tile/leagueTileModel'
import type { PushSelection } from '@/lib/core-app/notificationsCenter'
import { COLLIDING_TILES, TILE_STATES } from './fixtures'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-notifications.css'
import './handoff-preview.css'

/**
 * The dev preview's rendering half. Its server page builds the emails and runs
 * the push selection; this lays them out.
 *
 * ⚠ `af-core` IS ON THE ROOT ELEMENT, AND IT HAS TO BE. Every rule in the
 * component stylesheets reads tokens defined under `.af-core` — this page is not
 * inside AfCoreShell, so without the class every `var()` resolves to the empty
 * string and the whole page paints as unstyled boxes. Same two-part fix
 * (stylesheet import plus the class) that PricingV4, LandingV4, AuthV4 and
 * MyLeaguesV4 each carry a note about.
 */

type Email = { subject: string; html: string }

function Section({
  id,
  title,
  blurb,
  children,
}: {
  id: string
  title: string
  blurb: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="hp-section">
      <header className="hp-sechead">
        <h2 className="hp-sectitle">{title}</h2>
        <p className="hp-secblurb">{blurb}</p>
      </header>
      {children}
    </section>
  )
}

/**
 * Emails render inside an iframe with `srcDoc`.
 *
 * Not a div: these templates ship their own `<html>`, `<body>` and a full-page
 * dark background, and injecting that into the page would leak their styles into
 * everything around them. An iframe is also the only honest preview — it is the
 * same isolation a mail client gives them.
 */
function EmailFrame({ email, height }: { email: Email; height: number }) {
  return (
    <div className="hp-email">
      <div className="hp-subject">
        <span className="hp-subject-label">Subject</span>
        <span className="hp-subject-text">{email.subject}</span>
      </div>
      <iframe
        title={email.subject}
        srcDoc={email.html}
        className="hp-frame"
        style={{ height }}
        sandbox=""
      />
    </div>
  )
}

function LockScreen({ push }: { push: PushSelection }) {
  return (
    <div className="af-lock">
      <div className="af-lock-clock">
        <span className="af-lock-time">11:04</span>
        <span className="af-lock-date">Sunday 23 August</span>
      </div>
      <div className="af-lock-stack">
        {push.delivered.map((n) => (
          <div key={n.id} className="af-lock-card">
            <div className="af-lock-cardtop">
              <span className="af-lock-app">AF</span>
              <span className="af-lock-league">{n.leagueName ?? 'AllFantasy'}</span>
              <span className="af-lock-now">now</span>
            </div>
            <p className="af-lock-title">{n.title}</p>
            <p className="af-lock-detail">{n.detail}</p>
            {n.action ? <span className="af-lock-action">{n.action.label}</span> : null}
          </div>
        ))}
        {push.suppressedReason ? (
          <div className="af-lock-more">
            {push.suppressedCount} more from {push.suppressedLeagues} leagues
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function HandoffPreviewClient({
  tradeEmail,
  draftStartingEmail,
  draftRecapEmail,
  push,
}: {
  tradeEmail: Email
  draftStartingEmail: Email
  draftRecapEmail: Email
  push: PushSelection
}) {
  const [showAnatomy, setShowAnatomy] = useState(true)
  const colliding = findCollidingNames(COLLIDING_TILES)

  return (
    <main className="af-core hp">
      <header className="hp-head">
        <p className="hp-eyebrow">Dev only · 404s in production</p>
        <h1 className="hp-title">Handoff preview — 22a to 27a</h1>
        <p className="hp-sub">
          Twelve drops. The five that are real signed-in screens are linked, not mocked — a copy
          rendered with fake data is a copy that drifts from the thing it is previewing. What is
          rendered here is everything with no route of its own: three emails, the phone lock screen,
          and the league tile in all five states.
        </p>

        <nav className="hp-nav">
          <Link href="/core/week" className="hp-navlink">24a · Your week</Link>
          <Link href="/core/week?view=rivalries" className="hp-navlink">24b · Rivalry Radar</Link>
          <Link href="/core/season-outlook" className="hp-navlink">26b · Season Outlook</Link>
          <Link href="/core/tools" className="hp-navlink">25a · Tools</Link>
          <Link href="/core/share" className="hp-navlink">26a · Career Share</Link>
          <Link href="/core/notifications" className="hp-navlink">22c · Notifications</Link>
          <Link href="/core" className="hp-navlink hp-navlink--alt">
            23a/23b/25b · open /core, then the Chat button
          </Link>
        </nav>
      </header>

      <Section
        id="tile"
        title="27a — the league tile, every season state"
        blurb="One component, five lifecycle states. The image, the name and the format line never change; the status line is the only thing that does, and it always carries a reason or a next step rather than a bare state word."
      >
        <label className="hp-toggle">
          <input
            type="checkbox"
            checked={showAnatomy}
            onChange={(e) => setShowAnatomy(e.target.checked)}
          />
          Show anatomy labels
        </label>

        <div className="hp-tiles">
          {TILE_STATES.map((t) => (
            <div key={t.id} className="hp-tilewrap">
              {showAnatomy ? <span className="hp-tilelabel">{t.status.kind}</span> : null}
              <LeagueTile model={t} />
            </div>
          ))}
        </div>

        <h3 className="hp-subhead">The rail — the same tile at list density</h3>
        <div className="hp-rail">
          {TILE_STATES.map((t) => (
            <LeagueTile key={`rail-${t.id}`} model={t} variant="rail" />
          ))}
        </div>

        <h3 className="hp-subhead">The naming-collision bug, and the fix</h3>
        <p className="hp-note">
          Six leagues sharing a name, from a real production screenshot. Without disambiguation
          every row truncates to the same string and none of them is identifiable. The recommended
          fix is a user-set nickname; until one is set, the last four of the league id is appended —
          but only to names that actually collide, because a suffix on a unique name is noise.
        </p>
        <div className="hp-split">
          <div>
            <p className="hp-splitlabel">Before — no disambiguation</p>
            <div className="hp-rail">
              {COLLIDING_TILES.map((t) => (
                <LeagueTile key={`before-${t.id}`} model={t} variant="rail" />
              ))}
            </div>
          </div>
          <div>
            <p className="hp-splitlabel">After — collisions only</p>
            <div className="hp-rail">
              {COLLIDING_TILES.map((t) => (
                <LeagueTile
                  key={`after-${t.id}`}
                  model={t}
                  variant="rail"
                  collidingNames={colliding}
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="push"
        title="22c — phone notifications"
        blurb="At 61 leagues the job is suppression, not delivery. Three get through; everything without a deadline today collapses into one line. This stack is produced by the same selectPushNotifications() the product uses — it is the rule running, not an arrangement."
      >
        <div className="hp-phonerow">
          <LockScreen push={push} />
          <div className="hp-phonenote">
            <p>
              <b>{push.delivered.length} delivered.</b> Every one has a live deadline and names it.
            </p>
            <p>{push.suppressedReason}</p>
            <p>
              The in-app centre is the other half of this design and is a real screen —{' '}
              <Link href="/core/notifications">/core/notifications</Link>. Its &ldquo;Act today&rdquo;
              tier is built from the same urgency engine as the home queue and the Tools hub, so a
              lineup that is urgent in one place is urgent in all three.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="trade-email"
        title="22a — trade email"
        blurb="Rendered by buildTradeGradeEmail(), the same function the trade-notify cron sends through. GOT is always left and GAVE always right on both cards so the two sides compare directly; the verdict is three explicit lines, never prose; and the footer carries a per-league mute alongside the global unsubscribe, because at 61 leagues a global one is not a real choice."
      >
        <EmailFrame email={tradeEmail} height={1180} />
      </Section>

      <Section
        id="draft-emails"
        title="22b — draft emails"
        blurb="Two of the three draft moments. Availability percentages are computed from this league's own completed drafts and say so on every render — a national ADP board is a guess about different people. The recap splits remaining holes into waiver problems and genuine misses, because calling the first one a drafting error would be false."
      >
        <div className="hp-emails">
          <EmailFrame email={draftStartingEmail} height={860} />
          <EmailFrame email={draftRecapEmail} height={1000} />
        </div>
        <p className="hp-note hp-note--warn">
          <b>The third moment is not built.</b> The handoff&apos;s section title references a
          &ldquo;you&apos;re on the clock&rdquo; email alongside these two, but supplied no design
          for it and none has been invented. An in-app on-the-clock notification already exists
          (<code>notifyOnTheClockAfterPick</code>); whether it also warrants an email is an open
          question for product.
        </p>
      </Section>

      <Section
        id="screens"
        title="The five real screens"
        blurb="These are signed-in surfaces reading Postgres. They are linked rather than reproduced here — every one of them withholds numbers it cannot read, and a preview stuffed with synthetic data would hide exactly the behaviour worth checking."
      >
        <ul className="hp-list">
          <li>
            <Link href="/core/week">/core/week</Link> — 24a. Coin flips first, ordered by projected
            margin. Win probabilities are a stated heuristic with n printed; a matchup with too
            little history gets no percentage rather than a defaulted 50%.
          </li>
          <li>
            <Link href="/core/week?view=rivalries">/core/week?view=rivalries</Link> — 24b. All-time
            head-to-head paired with today&apos;s projection. A single meeting is never called a
            rivalry.
          </li>
          <li>
            <Link href="/core/season-outlook">/core/season-outlook</Link> — 26b. Ten thousand
            simulations per league over the real remaining schedule.{' '}
            <b>
              This route is the fix for a cited routing bug: the dashboard&apos;s &ldquo;Season
              Outlook&rdquo; tool pointed at /af-legacy?tab=pulse, the Legacy board&apos;s market
              tab.
            </b>
          </li>
          <li>
            <Link href="/core/tools">/core/tools</Link> — 25a. Grouped by job, with live deadlines
            and real token prices before the click. Carries the undecided
            four-trade-tools/three-comparison-routes question on the page rather than resolving it
            silently.
          </li>
          <li>
            <Link href="/core/share">/core/share</Link> — 26a. No load button, no username field,
            no vendor name, and the sharing reward stated exactly: one token, once a day.
          </li>
          <li>
            <Link href="/core">/core</Link> — 23a, 23b and 25b. The <b>Chat</b> button opens the
            four-tab drawer; open it from a league-scoped screen on a wide window and it docks
            beside the content with Chimmy already scoped to that league. <b>Contact support</b> in
            the left nav opens the 25b modal.
          </li>
        </ul>
      </Section>
    </main>
  )
}

export default HandoffPreviewClient
