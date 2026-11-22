import Link from 'next/link'

export function DeadlineReminderCard({
  label,
  href,
}: {
  label: string
  href: string
}) {
  return (
    <div className="rounded-xl border border-[rgba(240,163,94,0.34)] bg-[rgba(240,163,94,0.08)] p-3">
      <p className="font-mono text-[13px] tabular-nums text-[#f6d3ae]">⏱ {label}</p>
      <Link
        href={href}
        className="mt-2 inline-flex min-h-[44px] items-center text-[12px] font-semibold text-[var(--survivor-torch,#f0a35e)] underline"
      >
        Cast vote now
      </Link>
    </div>
  )
}
