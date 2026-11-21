import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { CollegeProRosterHarnessClient } from './CollegeProRosterHarnessClient'

/** Dev-only: the C2C / Devy two-lineup roster tab against a fixture shaped like Peach Bowl + Cream Bowl. */
export default function CollegeProRosterHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <Suspense fallback={null}>
      <CollegeProRosterHarnessClient />
    </Suspense>
  )
}
