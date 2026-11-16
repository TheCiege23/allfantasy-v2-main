'use client'

import { Skeleton } from '@/components/ui/skeleton'

interface AILoadingSkeletonProps {
  showFacts?: boolean
  showSynthesis?: boolean
  showAction?: boolean
  className?: string
}

export default function AILoadingSkeleton({
  showFacts = true,
  showSynthesis = true,
  showAction = true,
  className = '',
}: AILoadingSkeletonProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {showFacts && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <Skeleton className="mb-3 h-4 w-24" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" style={{ animationDelay: '150ms' }} />
            <Skeleton className="h-3 w-3/5" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}
      {showSynthesis && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <Skeleton className="mb-3 h-4 w-20" style={{ animationDelay: '100ms' }} />
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" style={{ animationDelay: '200ms' }} />
            <Skeleton className="h-3 w-full" style={{ animationDelay: '350ms' }} />
            <Skeleton className="h-3 w-2/3" style={{ animationDelay: '500ms' }} />
          </div>
        </div>
      )}
      {showAction && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <Skeleton className="mb-2 h-4 w-32" style={{ animationDelay: '200ms' }} />
          <Skeleton className="h-3 w-3/4" style={{ animationDelay: '400ms' }} />
        </div>
      )}
    </div>
  )
}
