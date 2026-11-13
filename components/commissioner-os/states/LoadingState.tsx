import { Skeleton } from '@/components/ui/skeleton'

export interface LoadingStateProps {
  /** Number of skeleton rows — matches the final content's approximate shape, never a generic spinner (Design Language §17). */
  rows?: number
}

export function LoadingState({ rows = 3 }: LoadingStateProps) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  )
}

