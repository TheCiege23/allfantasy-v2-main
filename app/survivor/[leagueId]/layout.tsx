import type { ReactNode } from 'react'
import { SurvivorAppShell } from './SurvivorAppShell'

export default async function SurvivorLeagueLayout(
  props: {
    children: ReactNode
    params: Promise<{ leagueId: string }>
  }
) {
  const params = await props.params

  const {
    children
  } = props;

  return <SurvivorAppShell leagueId={params.leagueId}>{children}</SurvivorAppShell>
}
