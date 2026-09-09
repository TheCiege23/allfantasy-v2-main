import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { LeagueSettingsView } from '@/components/commissioner-os/settings/LeagueSettingsView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

/**
 * Settings.
 *
 * 🛑 THIS FILE WAS FIFTEEN LINES THAT RENDERED A CENTRED PLACEHOLDER CARD, ON TOP OF 64 WORKING
 * `/api/commissioner/**` ROUTES. It called no adapter, read nothing, and described itself as "the
 * least 'intelligent' surface in Commissioner OS by design" — which was true and was not the reason
 * it was empty.
 *
 * It reports what this league's rules ARE, and derives nothing. See
 * `lib/commissioner-ui/settings/decision-os-client/types.ts` for the measurement that decided where
 * those rules are read from, and why the service that looks correct is not.
 */
export default async function SettingsPage() {
  const adapter = await getDecisionOSAdapter()
  const response = await adapter.settings.getSnapshot()

  return (
    <CommissionerPageContainer>
      <LeagueSettingsView
        snapshot={response.data}
        dataMode={adapter.mode}
        errorMessage={response.error?.message}
      />
    </CommissionerPageContainer>
  )
}
