'use client'

import Link from 'next/link'
import { usePartnerNudge } from '@/components/partner-codes/usePartnerNudge'

/**
 * "Partner Code" in the account menu. Commissioners (and code owners) only, and
 * only while the program is on — the server decides; everyone else gets nothing.
 * This is the permanent way back to the page after the home nudge is dismissed.
 */
export function PartnerCodeMenuLink({ className, onClick }: { className?: string; onClick?: () => void }) {
  const nudge = usePartnerNudge()
  if (!nudge?.show) return null
  return (
    <Link href="/partner-code" className={className} onClick={onClick}>
      Partner Code
    </Link>
  )
}
