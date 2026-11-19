import Link from 'next/link'
import '@/components/core-app/af-all-leagues.css'
import { getImportPlatforms, type ImportPlatform } from '@/lib/league-import/provider-ui-config'

/**
 * "All your leagues in one place — and ask Chimmy about any of them." The one thing reviewers said
 * mattered most, on the homepage and on /commissioners.
 *
 * 🛑 PLATFORM NAMES AND STATUS ARE READ FROM `provider-ui-config.ts`, NEVER TYPED. The chips, and the
 * platform each example league is shown on, come from `getImportPlatforms()`: a coming-soon platform
 * (Yahoo, today) gets a "Coming soon" chip and is never the home of an example league, for exactly as
 * long as the import API refuses it.
 *
 * The leagues and the exchange are an EXAMPLE and say so, like the landing hero card. Server component;
 * relies on the af-core / af-landing token layer the host page already loads.
 */

type AllLeaguesChimmyCopy = {
  label: string
  h2: string
  body: string
  exampleLabel: string
  question: string
  answer: string
  /** Optional line under the body ("Free accounts get 2 Chimmy questions a day."). */
  free?: string
  soon: string
}

/** Names stay fixed; which live platform each sits on is read from the config at render time. */
const EXAMPLE_LEAGUES = [
  { name: 'Dynasty Dragons', format: 'Dynasty PPR' },
  { name: 'Gridiron Gang', format: '0.5 PPR' },
  { name: 'Waiver Warriors', format: 'Standard' },
  { name: 'End Zone Elites', format: 'Keeper' },
] as const

function exampleLeaguePlatforms(platforms: ImportPlatform[] = getImportPlatforms()) {
  const live = platforms.filter((p) => p.status === 'live')
  if (live.length === 0) return []
  return EXAMPLE_LEAGUES.map((league, i) => ({ ...league, platform: live[i % live.length] }))
}

export function AllLeaguesChimmy({
  copy,
  cta,
  id = 'all-leagues',
}: {
  copy: AllLeaguesChimmyCopy
  cta?: { href: string; label: string }
  id?: string
}) {
  const platforms = getImportPlatforms()
  const leagues = exampleLeaguePlatforms(platforms)
  const headingId = `${id}-h2`

  return (
    <section className="af-lp-chimmy af-al" id={id} aria-labelledby={headingId} data-testid="all-leagues-chimmy">
      <div className="af-lp-chimmy-copy">
        <span className="af-label">{copy.label}</span>
        <h2 className="af-lp-h2" id={headingId}>
          {copy.h2}
        </h2>
        <p className="af-lp-chimmy-body">{copy.body}</p>
        <ul className="af-al-chips" aria-label="Platforms">
          {platforms.map((p) => (
            <li
              key={p.provider}
              className="af-al-chip"
              data-state={p.status === 'live' ? 'live' : 'soon'}
              data-provider={p.provider}
              // A "soon" platform is a placeholder — not shown in the iOS app (App Store 2.1), like the landing strip.
              data-hide-in-ios-app={p.status === 'live' ? undefined : ''}
            >
              <span className="af-platform af-platform-mark af-al-mark" data-platform={p.provider} aria-hidden>
                {p.name.charAt(0)}
              </span>
              {p.name}
              {p.status === 'coming_soon' ? <span className="af-lp-soon af-num">{copy.soon}</span> : null}
            </li>
          ))}
        </ul>
        {copy.free ? <p className="af-lp-chimmy-free">{copy.free}</p> : null}
        {cta ? (
          <Link href={cta.href} className="af-btn af-al-cta">
            {cta.label}
          </Link>
        ) : null}
      </div>

      <figure className="af-lp-chimmy-chat af-al-figure" aria-label={copy.exampleLabel}>
        <span className="af-lp-card-week af-num af-lp-chimmy-example">{copy.exampleLabel}</span>
        <ul className="af-al-leagues">
          {leagues.map((l) => (
            <li key={l.name} className="af-al-league" data-provider={l.platform.provider}>
              <span className="af-platform af-platform-mark af-al-mark" data-platform={l.platform.provider} aria-hidden>
                {l.platform.name.charAt(0)}
              </span>
              <span className="af-al-league-text">
                <span className="af-al-league-name">{l.name}</span>
                <span className="af-al-league-meta">
                  {l.platform.name} · {l.format}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="af-lp-chimmy-q">{copy.question}</p>
        <div className="af-lp-chimmy-a">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="af-lp-card-foot-avatar" src="/images/chimmy-avatar.png" alt="" width={30} height={30} loading="lazy" />
          <p>{copy.answer}</p>
        </div>
      </figure>
    </section>
  )
}
