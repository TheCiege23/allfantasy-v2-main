"use client"
import { useSearchParams, usePathname } from 'next/navigation'
export function Tracker() {
  const pathname = usePathname()
  const sp = useSearchParams()
  const key = sp?.toString() ? `${pathname}?${sp.toString()}` : pathname
  return <span data-tracker={key} style={{ display: 'none' }} />
}
