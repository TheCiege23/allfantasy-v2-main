import { notFound } from 'next/navigation'
import DraftSettingsPanel from '@/components/app/settings/DraftSettingsPanel'

export default async function E2EDraftSettingsHarnessPage(
  props: {
    searchParams?: Promise<{ leagueId?: string | string[] }>
  }
) {
  const searchParams = await props.searchParams
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  const sp = searchParams ? await searchParams : {}
  const raw = sp.leagueId
  const leagueId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] ?? '' : ''

  return (
    <div className="min-h-screen bg-[#040915] p-4">
      <h1 className="mb-4 text-lg font-semibold text-white">E2E draft settings harness</h1>
      <DraftSettingsPanel leagueId={leagueId} />
    </div>
  )
}
