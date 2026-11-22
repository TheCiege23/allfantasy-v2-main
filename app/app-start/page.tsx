import { cookies } from 'next/headers'
import { LANG_COOKIE_KEY, resolveLanguage } from '@/lib/i18n/constants'
import { AppStartClient } from './AppStartClient'

/**
 * The iOS app's launch screen (lib/platform/iosAppLaunch.ts explains why). Static apart from the
 * language cookie, so it answers in milliseconds and paints at once; the slow /core render happens
 * after, behind it.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'AllFantasy', robots: { index: false, follow: false } }

export default async function AppStartPage() {
  const language = resolveLanguage((await cookies()).get(LANG_COOKIE_KEY)?.value)
  return <AppStartClient text={language === 'es' ? 'Cargando tus ligas…' : 'Loading your leagues…'} />
}
