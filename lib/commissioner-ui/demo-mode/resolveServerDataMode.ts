import { cookies } from 'next/headers'
import { DATA_MODE_COOKIE_KEY, normalizeDataMode, type CommissionerDataMode } from './constants'

/** The one function every module's Server Component Decision OS client factory calls to decide which implementation to return. */
export async function resolveServerDataMode(): Promise<CommissionerDataMode> {
  const store = await cookies()
  return normalizeDataMode(store.get(DATA_MODE_COOKIE_KEY)?.value)
}
