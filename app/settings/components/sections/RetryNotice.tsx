"use client"

/** A load failure with its own way out: the message and a button that refetches just that card. */
export function RetryNotice({ message, onRetry, testId }: { message: string; onRetry: () => void; testId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3" role="alert">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border px-3 py-2 text-sm font-medium"
        style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
        data-testid={testId}
      >
        Try again
      </button>
    </div>
  )
}
