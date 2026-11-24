import { Suspense } from 'react'

import SupportWelcomeClient from './SupportWelcomeClient'

export const metadata = { title: 'Thank you for supporting AllFantasy' }

export default function SupportWelcomePage() {
  return (
    <Suspense fallback={null}>
      <SupportWelcomeClient />
    </Suspense>
  )
}
