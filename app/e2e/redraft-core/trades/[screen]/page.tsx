import { notFound } from 'next/navigation'
import RedraftCoreTradesHarnessClient, { type HarnessScreen } from '../RedraftCoreTradesHarnessClient'

const SCREENS: HarnessScreen[] = ['trades', 'war-room']

/**
 * DB-free render of the /core Trades and War Room screens inside the real AfCoreShell, for visual
 * review of batch B4 (scripts/redraft-core-trades-capture.mjs). Production is refused here and by
 * app/e2e/layout.tsx. Mode comes from the real `af_mode` cookie the root layout reads.
 *
 *   /e2e/redraft-core/trades/trades?sport=NBA&deadline=open      ← open | final | passed | none | scheduled | unknown
 *   /e2e/redraft-core/trades/war-room?sport=NHL&franchise=1      ← with the connected-franchise room
 *   /e2e/redraft-core/trades/trades?sport=NFL&leagueType=dynasty ← a non-redraft league: must stay default
 *   …&identity=off                                                ← the shell with no stamp at all
 */
export default async function RedraftCoreTradesHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen } = await params
  if (!(SCREENS as string[]).includes(screen)) notFound()
  const sp = await searchParams
  return (
    <RedraftCoreTradesHarnessClient
      screen={screen as HarnessScreen}
      sport={sp.sport ?? 'NFL'}
      platform={sp.platform ?? 'allfantasy'}
      leagueType={sp.leagueType ?? 'redraft'}
      identityOff={sp.identity === 'off'}
      deadline={sp.deadline ?? 'open'}
      franchise={sp.franchise === '1'}
    />
  )
}
