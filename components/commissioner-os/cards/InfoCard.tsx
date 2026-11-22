import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { ReactNode } from 'react'

interface InfoCardProps {
  title: string
  children: ReactNode
}

/** Static, non-metric explanatory content — no number, no chart (Design Language §4). */
export function InfoCard({ title, children }: InfoCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm" style={{ color: 'var(--muted)' }}>
        {children}
      </CardContent>
    </Card>
  )
}
