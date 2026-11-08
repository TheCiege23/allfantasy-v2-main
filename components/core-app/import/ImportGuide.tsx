'use client'

/**
 * The per-platform "how to connect" guide that sits beside the import form.
 *
 * ⚠ WRITTEN AGAINST THE COMPLAINTS, NOT AGAINST THE HAPPY PATH. The 2026-11-06 research pass
 * into why people give up importing a league into a third-party tool came back with the same
 * handful of failures across every competitor: ESPN cookie instructions that went stale when a
 * browser moved its menus, a truncated `espn_s2` that reads as "ESPN rejected me", phone users
 * who cannot reach devtools at all, a Fantrax ID nobody can find inside the app, and a Sleeper
 * DISPLAY name typed where the username belongs. Each of those is a step or a "common snag" below.
 *
 * ⚠ EVERY CLAIM HERE HAS TO BE TRUE OF THIS PRODUCT TODAY. Two in particular are load bearing:
 *   - "do the cookie step once on a computer and your phone picks it up" is true because
 *     `league_auths` is keyed on the USER, and EspnConnectPanel re-checks when the tab becomes
 *     visible again (see its desktop-pairing note). Nothing is handed between devices.
 *   - The ESPN steps tell people to paste into the boxes below — the manual form — because the
 *     one-click extension is unpublished, so the manual form is the only door (EspnConnectPanel).
 * If either of those changes, this copy changes with it.
 *
 * ⚠ IT RENDERS ONCE. On a wide screen CSS moves it into the right-hand column of the connect card;
 * on a phone it sits in the flow between the platform row and the field, collapsible. A second copy
 * for the other layout would duplicate every sentence for screen readers and for getByText.
 */

import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import '@/components/core-app/af-core.css'
import '@/components/core-app/af-import-guide.css'
import type { ImportProvider } from '@/lib/league-import/types'

type UrlHint = {
  /** Shown before the highlighted part, e.g. `fantasy.espn.com/football/league?leagueId=` */
  before: string
  /** The part we want — drawn highlighted. */
  id: string
  after?: string
  /** Under the bar: "ESPN app: League → League Info". */
  caption?: ReactNode
}

/**
 * A screenshot slot. The file lives under `public/import-guides/…` (see the README there for the
 * exact names). Until a file is added the slot renders NOTHING in production — a broken image or a
 * "screenshot coming soon" box on a live screen is worse than no picture — and a labelled dashed
 * box in development, so whoever adds the images can see where each one goes.
 */
type GuideShot = { src: string; alt: string }

type BrowserPath = { key: string; label: string; path: ReactNode[]; shot?: GuideShot }

type GuideStep = {
  title: string
  body?: ReactNode
  url?: UrlHint
  browsers?: BrowserPath[]
  shot?: GuideShot
  /** The step is satisfied by a connected ESPN account (the cookie steps of ESPN). */
  doneWhenEspnConnected?: boolean
}

type GuideTrack = { key: string; label: string; badge?: string; steps: GuideStep[] }

type Guide = {
  /** "≈ 30 sec", "≈ 3 min, once" */
  effort: string
  /** Second chip: what kind of setup this is. */
  setup: string
  /** A banner above the steps, for the one fact people need before starting. */
  heads?: ReactNode
  tracks: GuideTrack[]
  snags: { q: string; a: ReactNode }[]
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="af-guide-kbd">{children}</kbd>
}

const ESPN_BROWSERS: BrowserPath[] = [
  {
    key: 'chrome',
    label: 'Chrome / Edge',
    path: [
      <>
        Press <Kbd>F12</Kbd> <span className="af-guide-or">(Mac: <Kbd>⌥⌘I</Kbd>)</span>
      </>,
      <>
        <strong>Application</strong> tab
      </>,
      <>
        <strong>Cookies</strong> → <strong>https://fantasy.espn.com</strong>
      </>,
    ],
    shot: {
      src: '/import-guides/espn/02-chrome-devtools-application-cookies.png',
      alt: 'Chrome DevTools, Application tab, Cookies for fantasy.espn.com, with SWID and espn_s2 highlighted',
    },
  },
  {
    key: 'safari',
    label: 'Safari',
    path: [
      <>
        <strong>Safari → Settings → Advanced</strong> → tick <strong>Show features for web developers</strong>
      </>,
      <>
        Press <Kbd>⌥⌘I</Kbd> → <strong>Storage</strong> tab
      </>,
      <>
        <strong>Cookies</strong> → <strong>fantasy.espn.com</strong>
      </>,
    ],
    shot: {
      src: '/import-guides/espn/02-safari-web-inspector-storage-cookies.png',
      alt: 'Safari Web Inspector, Storage tab, Cookies for fantasy.espn.com, with SWID and espn_s2 highlighted',
    },
  },
  {
    key: 'firefox',
    label: 'Firefox',
    path: [
      <>
        Press <Kbd>F12</Kbd> <span className="af-guide-or">(Mac: <Kbd>⌥⌘I</Kbd>)</span>
      </>,
      <>
        <strong>Storage</strong> tab
      </>,
      <>
        <strong>Cookies</strong> → <strong>https://fantasy.espn.com</strong>
      </>,
    ],
    shot: {
      src: '/import-guides/espn/02-firefox-devtools-storage-cookies.png',
      alt: 'Firefox DevTools, Storage tab, Cookies for fantasy.espn.com, with SWID and espn_s2 highlighted',
    },
  },
]

const GUIDES: Partial<Record<ImportProvider, Guide>> = {
  sleeper: {
    effort: '≈ 30 sec',
    setup: 'No setup',
    tracks: [
      {
        key: 'username',
        label: 'Username',
        steps: [
          {
            title: 'Type your Sleeper username',
            body: (
              <>
                It&rsquo;s the <strong>@handle</strong> on your Sleeper profile — not your display
                name. Already linked Sleeper to AllFantasy? Leave the box blank.
              </>
            ),
          },
          {
            title: 'Press Find my leagues',
            body: <>We list every league on that account this season. No password, ever.</>,
          },
          {
            title: 'Tick the leagues you want',
            body: <>Import them all in one go, or one at a time.</>,
          },
        ],
      },
    ],
    snags: [
      {
        q: 'No leagues came back',
        a: (
          <>
            Check it&rsquo;s your <strong>username</strong>, not your display name — they are often
            different. Sleeper only lists leagues for the current season.
          </>
        ),
      },
      {
        q: 'I’m not the commissioner',
        a: <>You can still import. If we can&rsquo;t verify you automatically, we ask you to confirm you play in the league.</>,
      },
      {
        q: 'It says the account is linked to another login',
        a: <>That Sleeper account belongs to a different AllFantasy sign-in. Sign in with that one to import its leagues.</>,
      },
    ],
  },
  espn: {
    effort: '≈ 3 min, once',
    setup: 'Computer needed once',
    heads: (
      <>
        <strong>On your phone?</strong> Phone browsers can&rsquo;t show cookies. Do steps 1&ndash;3
        once on any computer signed in to AllFantasy — this page notices on its own, and every ESPN
        league you&rsquo;re in works from then on.
      </>
    ),
    tracks: [
      {
        key: 'cookies',
        label: 'Connect ESPN',
        /*
         * ⚠ LEAGUE FIRST (2026-11-08). The form now asks for the league and tests it before the
         * cookie step, so the guide follows the same order: someone with a public league learns
         * that at step 1, and the cookie steps are labelled as what confirms their team.
         */
        steps: [
          {
            title: 'Paste your league ID or link, then Test connection',
            body: (
              <>
                We check the league straight away and tell you its name, how many teams it has, and
                whether it&rsquo;s public or private.
              </>
            ),
            url: {
              before: 'fantasy.espn.com/football/league?leagueId=',
              id: '123456',
              caption: (
                <>
                  ESPN app: <strong>League</strong> → <strong>League Info</strong>. Paste the number
                  or the whole link.
                </>
              ),
            },
            shot: {
              src: '/import-guides/espn/01-league-id-in-address-bar.png',
              alt: 'An ESPN fantasy football league page with the leagueId number highlighted in the address bar',
            },
          },
          {
            title: 'Sign in at fantasy.espn.com on a computer',
            body: <>Chrome, Edge, Safari or Firefox all work. Open any page of your league.</>,
            doneWhenEspnConnected: true,
          },
          {
            title: 'Copy your two ESPN cookies',
            body: (
              <>
                Find <strong>SWID</strong> and <strong>espn_s2</strong>. Double-click each Value cell
                to select all of it — <strong>espn_s2</strong> is very long, and SWID keeps its{' '}
                <strong>{'{ }'}</strong> braces.
              </>
            ),
            browsers: ESPN_BROWSERS,
            doneWhenEspnConnected: true,
          },
          {
            title: 'Paste both below and save',
            body: (
              <>
                We test them against your league first, then store them encrypted. They let us read
                your leagues as you — they are not your password, and we never ask for it. Disconnect
                ESPN any time.
              </>
            ),
            shot: {
              src: '/import-guides/espn/03-paste-cookies-into-allfantasy.png',
              alt: 'The AllFantasy ESPN cookie form with SWID and espn_s2 pasted',
            },
            doneWhenEspnConnected: true,
          },
        ],
      },
    ],
    snags: [
      {
        q: '“ESPN rejected these cookies”',
        a: (
          <>
            Almost always a partial copy. Press <strong>Show what I pasted</strong> and check that{' '}
            <strong>espn_s2</strong> is the whole value and SWID starts with <strong>{'{'}</strong>.
          </>
        ),
      },
      {
        q: 'It worked before, now it fails',
        a: (
          <>
            ESPN ends the cookies when you sign out of ESPN on that browser. Sign back in, copy them
            again, and use <strong>Update cookies</strong>.
          </>
        ),
      },
      {
        q: 'I only have my phone',
        a: <>Do the cookie step once on any computer — a friend&rsquo;s or a library&rsquo;s is fine. Your phone is connected after that.</>,
      },
      {
        q: 'League not found',
        a: <>Make sure the ESPN account you copied cookies from is a member of that league, and that the ID is from this season&rsquo;s league page.</>,
      },
    ],
  },
  fantrax: {
    effort: '≈ 1 min',
    setup: 'Two ways in',
    tracks: [
      {
        key: 'secret',
        label: 'Secret ID',
        badge: 'Fastest',
        steps: [
          {
            title: 'Open your Fantrax profile',
            body: <>Sign in at fantrax.com, then open your profile page.</>,
            /* Location from the one public guide that shows it (Prospects Live's Fantrax sync page,
               which links fantrax.com/user/profile). Fantrax publishes no doc for it. */
            url: { before: 'fantrax.com/user/', id: 'profile' },
          },
          {
            title: 'Copy your Secret ID',
            body: <>It&rsquo;s listed on your profile. We only ever use it to read your leagues.</>,
          },
          {
            title: 'Paste it below → Connect Fantrax',
            body: <>We list every league you&rsquo;re in and already know which team is yours. Stored encrypted.</>,
          },
        ],
      },
      {
        key: 'league',
        label: 'League ID',
        steps: [
          {
            title: 'Open your league on fantrax.com',
            body: <>On the Fantrax app? Open fantrax.com in your phone&rsquo;s browser instead — the app hides the address.</>,
            url: { before: 'fantrax.com/fantasy/league/', id: 'v2kzedypmm8jp61b', after: '/home' },
          },
          {
            title: 'Paste the link or the ID below',
            body: <>The ID is the 16-character code — letters and numbers — after <strong>/league/</strong>.</>,
          },
          {
            title: 'Pick which team is yours',
            body: <>A league ID is public, so we show you the teams and you point at yours.</>,
          },
        ],
      },
    ],
    snags: [
      {
        q: 'Fantrax won’t read my league',
        a: <>Try the Secret ID instead, or upload a CSV export from Fantrax — the export also carries past seasons.</>,
      },
      {
        q: 'Which number is the league ID?',
        a: <>The code after <strong>/league/</strong> in the address bar, not your team&rsquo;s page or a number from the app.</>,
      },
    ],
  },
  mfl: {
    effort: '≈ 2 min, once',
    setup: 'API key needed',
    tracks: [
      {
        key: 'key',
        label: 'League ID + key',
        steps: [
          {
            title: 'Save your MFL API key once',
            body: (
              <>
                In <Link href="/settings?tab=connected">Settings → Connected Accounts</Link>. MFL needs
                it for every league, public ones too. It is not your password.
              </>
            ),
          },
          {
            title: 'Copy your league address',
            url: { before: 'www44.myfantasyleague.com/2026/home/', id: '12345' },
            body: <>The server number (www44) and year vary — paste whatever your browser shows.</>,
          },
          { title: 'Paste it below and press Connect' },
        ],
      },
    ],
    snags: [
      {
        q: 'It says I need an API key',
        a: <>Save it once in Settings → Connected Accounts, then come back — the league ID you pasted stays valid.</>,
      },
      {
        q: 'A brand-new league isn’t found',
        a: <>MFL can take a while to publish a newly created league. Try again later in the day.</>,
      },
    ],
  },
  fleaflicker: {
    effort: '≈ 20 sec',
    setup: 'Nothing to connect',
    tracks: [
      {
        key: 'id',
        label: 'League ID',
        steps: [
          {
            title: 'Open your league on fleaflicker.com',
            url: { before: 'fleaflicker.com/nfl/leagues/', id: '206154' },
          },
          {
            title: 'Paste the link or number below',
            body: <>Fleaflicker publishes league data, so there&rsquo;s no account or key to connect.</>,
          },
        ],
      },
    ],
    snags: [
      {
        q: 'Trades or history look thin',
        a: <>We show exactly what Fleaflicker publishes for your league on the preview, before anything is imported.</>,
      },
    ],
  },
}

function UrlBar({ hint }: { hint: UrlHint }) {
  return (
    <figure className="af-guide-url">
      <div className="af-guide-url-bar" aria-label={`${hint.before}${hint.id}${hint.after ?? ''}`}>
        <svg className="af-guide-url-lock" width="11" height="12" viewBox="0 0 13 14" fill="none" aria-hidden>
          <rect x="1" y="5.75" width="11" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3.75 5.75V4a2.75 2.75 0 0 1 5.5 0v1.75" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <span className="af-guide-url-text" aria-hidden>
          <span className="af-guide-url-dim">{hint.before}</span>
          <mark className="af-guide-url-id">{hint.id}</mark>
          {hint.after ? <span className="af-guide-url-dim">{hint.after}</span> : null}
        </span>
      </div>
      {hint.caption ? <figcaption className="af-guide-url-cap">{hint.caption}</figcaption> : null}
    </figure>
  )
}

function GuideScreenshot({ shot }: { shot: GuideShot }) {
  /* Hidden until it actually loads, so a missing file never flashes a broken-image icon. */
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading')
  const imgRef = useRef<HTMLImageElement | null>(null)
  /*
   * ⚠ A server-rendered <img> can finish (or fail) BEFORE React attaches onLoad/onError, and then
   * neither ever fires — the slot would sit hidden in 'loading' forever. Read the settled state
   * once on mount instead of trusting the events alone.
   */
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete) setState(img.naturalWidth > 0 ? 'ok' : 'missing')
  }, [shot.src])
  if (state === 'missing') {
    if (process.env.NODE_ENV === 'production') return null
    return (
      <figure className="af-guide-shot af-guide-shot--placeholder" data-testid="guide-shot-placeholder">
        <figcaption>
          Screenshot slot — add <code>public{shot.src}</code>
          <br />
          {shot.alt}
        </figcaption>
      </figure>
    )
  }
  return (
    <figure className="af-guide-shot" data-state={state} hidden={state !== 'ok'}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static guide image; next/image needs dimensions we do not have until the screenshots exist */}
      <img
        ref={imgRef}
        src={shot.src}
        alt={shot.alt}
        decoding="async"
        onLoad={() => setState('ok')}
        onError={() => setState('missing')}
      />
    </figure>
  )
}

function BrowserTabs({ browsers }: { browsers: BrowserPath[] }) {
  const [active, setActive] = useState(browsers[0]?.key ?? '')
  /* Open on the browser the reader is actually using. Safari's UA also says "Safari" inside
     Chrome's, so Chrome/Edge/Firefox are ruled out first. */
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const ua = navigator.userAgent
    if (/Firefox\//.test(ua)) setActive('firefox')
    else if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) setActive('safari')
  }, [])
  const current = browsers.find((b) => b.key === active) ?? browsers[0]
  return (
    <div className="af-guide-browsers">
      <div className="af-guide-seg" role="tablist" aria-label="Your browser">
        {browsers.map((b) => (
          <button
            key={b.key}
            type="button"
            role="tab"
            aria-selected={b.key === current?.key}
            className="af-guide-seg-btn"
            onClick={() => setActive(b.key)}
          >
            {b.label}
          </button>
        ))}
      </div>
      {current ? (
        <ol className="af-guide-path" role="tabpanel" aria-label={`${current.label} steps`}>
          {current.path.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      ) : null}
      {current?.shot ? <GuideScreenshot key={current.key} shot={current.shot} /> : null}
    </div>
  )
}

export type ImportGuideProps = {
  provider: ImportProvider
  providerLabel: string
  /** Whether the provider can be imported today. A paused one gets a status card, not steps. */
  available: boolean
  espnConnected?: boolean | null
  /** The platform mark, so the guide's header matches the tile that is lit. */
  mark: ReactNode
}

export function ImportGuide({ provider, providerLabel, available, espnConnected, mark }: ImportGuideProps) {
  const guide = GUIDES[provider]
  /*
   * Collapsible on a phone only (CSS ignores it on wide screens). Opens by default for the
   * platforms whose setup is the hard part — the ones people abandon — and closed for the
   * one-box ones, where the field itself is the whole instruction.
   */
  const startsOpen = provider === 'espn' || provider === 'fantrax' || provider === 'mfl'
  const [open, setOpen] = useState(startsOpen)
  const [track, setTrack] = useState(guide?.tracks[0]?.key ?? '')
  useEffect(() => {
    setOpen(provider === 'espn' || provider === 'fantrax' || provider === 'mfl')
    setTrack(GUIDES[provider]?.tracks[0]?.key ?? '')
  }, [provider])

  if (!available || !guide) {
    return (
      <aside className="af-guide af-guide--paused" data-provider={provider} aria-label={`${providerLabel} status`}>
        <header className="af-guide-head">
          {mark}
          <span className="af-guide-head-text">
            <span className="af-label">{providerLabel}</span>
            <span className="af-guide-title">Coming soon</span>
          </span>
        </header>
        <p className="af-guide-paused-body">
          Not open for imports yet. When it is, you&rsquo;ll sign in with {providerLabel}, approve
          read-only access and pick your leagues &mdash; no IDs to hunt for.
        </p>
      </aside>
    )
  }

  const activeTrack = guide.tracks.find((t) => t.key === track) ?? guide.tracks[0]
  const steps = activeTrack?.steps ?? []
  const isDone = (s: GuideStep) => Boolean(s.doneWhenEspnConnected && espnConnected === true)
  const doneCount = steps.filter(isDone).length
  /* The first step not yet done — done steps are no longer always the leading ones. */
  const currentIndex = steps.findIndex((s) => !isDone(s))

  return (
    <aside
      className="af-guide"
      data-provider={provider}
      data-open={open ? 'true' : 'false'}
      aria-label={`How to connect ${providerLabel}`}
    >
      <button
        type="button"
        className="af-guide-head af-guide-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {mark}
        <span className="af-guide-head-text">
          <span className="af-label">How to connect</span>
          <span className="af-guide-title">
            {providerLabel} in {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
        </span>
        <span className="af-guide-chevron" aria-hidden>
          ⌄
        </span>
      </button>

      <div className="af-guide-body">
        <div className="af-guide-chips">
          <span className="af-guide-chip af-num">{guide.effort}</span>
          <span className="af-guide-chip af-num">{guide.setup}</span>
          {doneCount > 0 ? (
            <span className="af-guide-chip af-guide-chip--good af-num">Cookie steps done</span>
          ) : null}
        </div>

        {guide.heads && !(provider === 'espn' && espnConnected === true) ? (
          <p className="af-guide-heads">{guide.heads}</p>
        ) : null}

        {guide.tracks.length > 1 ? (
          <div className="af-guide-seg af-guide-seg--tracks" role="tablist" aria-label={`Ways to connect ${providerLabel}`}>
            {guide.tracks.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === activeTrack?.key}
                className="af-guide-seg-btn"
                onClick={() => setTrack(t.key)}
              >
                {t.label}
                {t.badge ? <span className="af-guide-seg-badge af-num">{t.badge}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        <ol className="af-guide-steps">
          {steps.map((s, i) => {
            const done = Boolean(s.doneWhenEspnConnected && espnConnected === true)
            const current = !done && i === currentIndex
            return (
              <li
                key={`${activeTrack?.key}-${i}`}
                className="af-guide-step"
                data-done={done ? 'true' : undefined}
                data-current={current ? 'true' : undefined}
              >
                <span className="af-guide-num af-num" aria-hidden>
                  {done ? '✓' : i + 1}
                </span>
                <div className="af-guide-step-main">
                  <p className="af-guide-step-title">
                    {s.title}
                    {done ? <span className="af-guide-sr"> (done)</span> : null}
                  </p>
                  {s.body && !done ? <p className="af-guide-step-body">{s.body}</p> : null}
                  {s.browsers && !done ? <BrowserTabs browsers={s.browsers} /> : null}
                  {s.url && !done ? <UrlBar hint={s.url} /> : null}
                  {s.shot && !done ? <GuideScreenshot shot={s.shot} /> : null}
                </div>
              </li>
            )
          })}
        </ol>

        {guide.snags.length > 0 ? (
          <details className="af-guide-snags">
            <summary className="af-guide-snags-sum">
              <span className="af-label">Stuck? Common snags</span>
              <span className="af-guide-snags-count af-num">{guide.snags.length}</span>
            </summary>
            <dl className="af-guide-snag-list">
              {guide.snags.map((s) => (
                <div key={s.q} className="af-guide-snag">
                  <dt>{s.q}</dt>
                  <dd>{s.a}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}

        <p className="af-guide-preview-note">
          Importing one league at a time? You get a preview of exactly what comes across before
          anything is saved.
        </p>
      </div>
    </aside>
  )
}

export default ImportGuide
