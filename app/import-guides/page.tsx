import type { Metadata } from 'next'
import Link from 'next/link'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'League Import Guides | AllFantasy',
  description:
    'Step-by-step instructions for importing your fantasy leagues from Sleeper, ESPN, and Yahoo into AllFantasy.',
}

/**
 * Platform availability here MUST match `lib/league-import/provider-ui-config.ts`.
 * Sleeper / ESPN / Yahoo are `available: true`; Fantrax, MyFantasyLeague and
 * Fleaflicker are `available: false` and are described as in-progress, never as
 * working. Update the config first if that ever changes.
 */
export default function ImportGuidesPage() {
  return (
    <V3PageShell
      title="Import guides"
      lead="Exactly what to do for each platform, in plain language. Sleeper works without an account; the others need a free signup so we have somewhere to store the connection."
    >
      <V3Section title="Sleeper — no account needed">
        <p>
          Open the Sleeper app or sleeper.com and sign in. Tap your avatar in the top corner; your username is shown on
          your profile page. Enter that username on our{' '}
          <Link href="/#import" style={{ color: 'var(--purple-bright)' }}>
            import form
          </Link>{' '}
          and we pull in every league on that profile.
        </p>
        <p>
          We only read your public Sleeper profile. We never ask for your password, and nothing in your league is
          changed.
        </p>
      </V3Section>

      <V3Section title="ESPN — free account required">
        <p>
          Sign in at fantasy.espn.com and open the league you want. Your League ID is the number immediately after
          &ldquo;leagueId=&rdquo; in the address bar.
        </p>
        <p>
          ESPN offers no anonymous lookup, and private leagues additionally require your ESPN session cookies (SWID and
          espn_s2). We store those encrypted against your AllFantasy account, which is why this route needs a free
          signup before you can finish connecting.
        </p>
      </V3Section>

      <V3Section title="Yahoo — free account required">
        <p>
          Yahoo uses OAuth. You click &ldquo;Connect Yahoo&rdquo;, sign in on Yahoo&rsquo;s own site, and approve read
          access — we never see your Yahoo password. Because OAuth issues a token that has to belong to an account,
          you need a free AllFantasy account first.
        </p>
      </V3Section>

      <V3Section title="Fantrax, MyFantasyLeague and Fleaflicker — in progress">
        <p>
          These are not connectable yet. We list them because they are actively being worked on, not because they
          currently work. When one is genuinely ready it will appear as an available platform in the import wizard.
        </p>
        <p>
          If one of these is the league you care about,{' '}
          <Link href="/contact" style={{ color: 'var(--purple-bright)' }}>
            tell us
          </Link>{' '}
          — it helps us prioritize.
        </p>
      </V3Section>

      <V3Section title="AllFantasy native leagues">
        <p>
          If you would rather start fresh, you can{' '}
          <Link href="/create-league" style={{ color: 'var(--purple-bright)' }}>
            create a league
          </Link>{' '}
          directly on AllFantasy with full commissioner tools and no import step at all.
        </p>
      </V3Section>
    </V3PageShell>
  )
}
