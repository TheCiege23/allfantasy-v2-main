import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { CreateLeaguePageClient } from './CreateLeaguePageClient'

export const dynamic = 'force-dynamic'

function firstStringParam(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined
  return typeof value === 'string' ? value : value[0]
}

export default async function CreateLeaguePage(
  props: {
    searchParams?: Promise<| Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>>
  }
) {
  const searchParams = await props.searchParams
  const sp =
    searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const e2eAuth = firstStringParam(sp.e2eAuth)
  const allowE2EBypass = process.env.NODE_ENV !== 'production' && e2eAuth === '1'

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  const userId =
    session?.user?.id ?? (allowE2EBypass ? 'e2e-user' : undefined)

  if (!userId) {
    redirect('/login?callbackUrl=/create-league')
  }

  return <CreateLeaguePageClient userId={userId} />
}
