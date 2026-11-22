import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

export interface TimelineEntry {
  id: string
  label: string
  timestamp: string
}

interface TimelineCardProps {
  title: string
  entries: TimelineEntry[]
  emptyText: string
}

/** Chronological, factual — entries are facts, not intelligence (Design Language §4). */
export function TimelineCard({ title, entries, emptyText }: TimelineCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted2)' }}>
            {emptyText}
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                <span style={{ color: 'var(--text)' }}>{entry.label}</span>
                <span className="text-xs" style={{ color: 'var(--muted2)' }}>
                  {entry.timestamp}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
