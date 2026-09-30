import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Link from 'next/link'
import { ImportWizard } from '@/app/devy/components/ImportWizard'

export const dynamic = 'force-dynamic'

export default async function DevyImportPage(
  props: {
    params: Promise<{ leagueId: string }>
    searchParams?: Promise<Record<string, string | string[] | undefined>>
  }
) {
  const searchParams = await props.searchParams
  const { leagueId } = await props.params
  const sp = searchParams ? await searchParams : {}
  const sid = sp.sessionId
  const initialSessionId = typeof sid === 'string' ? sid : Array.isArray(sid) ? sid[0] : undefined
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/devy/${leagueId}/import`)}`)
  }

  return (
    <div className="min-h-screen bg-[#040915] text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#0c0c1e]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <Link href={`/league/${leagueId}`} className="text-[12px] font-semibold text-cyan-300/90">
            ← League
          </Link>
          <span className="text-[13px] font-bold">Import</span>
          <span className="w-12" />
        </div>
      </header>
      <ImportWizard leagueId={leagueId} initialSessionId={initialSessionId} />
    </div>
  )
}
