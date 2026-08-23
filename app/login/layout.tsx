import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'

export const metadata: Metadata = buildSeoMeta({
  title: 'Sign In | AllFantasy.ai',
  description:
    'Sign in to AllFantasy.ai — AI-powered fantasy sports tools, leagues, and Chimmy coaching.',
  canonicalPath: '/login',
  /*
   * ⚠ THE RULE IS ALREADY WRITTEN DOWN IN app/signup/layout.tsx — "authentication
   * surfaces must not be indexed (closed beta)" — AND ONLY SIGNUP WAS FOLLOWING IT.
   * /login, /forgot-password and /reset-password all inherited the root layout's
   * `index, follow`, so the sign-in wall was the crawlable face of a closed beta.
   * A search result landing a stranger on a login form is a dead end for them and
   * a diluted set of indexed pages for us.
   */
  noIndex: true,
})

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
