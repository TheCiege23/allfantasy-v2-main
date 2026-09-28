import { loadConnectLeagueFacts } from '@/lib/core-app/connectLeagueReads'
import { connectLeagueCopy, connectLeagueHref, connectLeagueStep } from '@/lib/core-app/connectLeague'
import { ResendVerificationButton } from './ResendVerificationButton'

/**
 * The first thing on the /core home for anyone whose team we do not know yet — see
 * lib/core-app/connectLeague.ts for who that is and why. Renders nothing for everyone else, and
 * nothing when its reads fail.
 */
export async function ConnectLeagueCard({ userId, leagueCount }: { userId: string; leagueCount: number }) {
  const facts = await loadConnectLeagueFacts(userId, leagueCount)
  if (!facts) return null
  const step = connectLeagueStep(facts)
  if (step === 'none') return null
  const copy = connectLeagueCopy(step)

  return (
    <section className="af3a-card af-connect" data-step={step} aria-labelledby="af-connect-title">
      <div className="af-connect-body">
        <p className="af3a-label">GET STARTED</p>
        <h2 id="af-connect-title" className="af-connect-title">
          {copy.title}
        </h2>
        <p className="af-connect-text">{copy.body}</p>
      </div>
      <div className="af-connect-actions">
        {step === 'verify' ? (
          <ResendVerificationButton label={copy.cta} />
        ) : (
          <a className="af-connect-go" href={connectLeagueHref({ sleeperLinked: facts.sleeperLinked })}>
            {copy.cta}
          </a>
        )}
      </div>
    </section>
  )
}
