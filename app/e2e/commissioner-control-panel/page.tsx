import { notFound } from 'next/navigation'
import { CommissionerControlPanelHarnessClient } from './CommissionerControlPanelHarnessClient'

export default async function E2ECommissionerControlPanelPage(props: {
  searchParams?:
    | Promise<{ leagueId?: string }>
    | { leagueId?: string }
}) {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  const sp = props.searchParams ?? {}
  const resolved =
    typeof (sp as Promise<{ leagueId?: string }>).then === 'function'
      ? await (sp as Promise<{ leagueId?: string }>)
      : (sp as { leagueId?: string })

  const leagueId = resolved.leagueId?.trim() || 'e2e-commissioner-control-panel'
  return <CommissionerControlPanelHarnessClient leagueId={leagueId} />
}
