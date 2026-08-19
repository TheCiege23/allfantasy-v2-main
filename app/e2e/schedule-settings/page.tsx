import { notFound } from 'next/navigation'
import ScheduleSettingsPanel from '@/components/app/settings/ScheduleSettingsPanel'

export default async function E2EScheduleSettingsPage(props: {
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
      <h1 className="mb-4 text-xl font-semibold">E2E Schedule Settings Harness</h1>
      <ScheduleSettingsPanel leagueId={leagueId} />
    </main>
  )
}
