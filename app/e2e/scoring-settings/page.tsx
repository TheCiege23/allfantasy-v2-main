import { notFound } from 'next/navigation'
import ScoringSettingsPanel from '@/components/app/settings/ScoringSettingsPanel'

export default async function E2EScoringSettingsPage(props: {
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

  const leagueId = resolved.leagueId?.trim() || 'e2e-league'

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Scoring Settings Harness</h1>
      <ScoringSettingsPanel leagueId={leagueId} />
    </main>
  )
}
