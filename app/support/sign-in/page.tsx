import { Suspense } from 'react'

import SupportSignInClient from './SupportSignInClient'

export const metadata = { title: 'Sign in to AllFantasy' }

export default function SupportSignInPage() {
  return (
    <Suspense fallback={null}>
      <SupportSignInClient />
    </Suspense>
  )
}
