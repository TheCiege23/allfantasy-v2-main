import Link from 'next/link'

export function DemoUnavailableCard() {
  return (
    <section className="af-card mt-6 p-6 text-center" data-testid="demo-unavailable">
      <h1 className="text-xl font-black">The demo league is taking a breather</h1>
      <p className="mt-2 text-sm af-muted">It&apos;s not available right now. You can still set up your own league in a couple of minutes.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/signup" className="af-button-primary inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold">Sign up free</Link>
        <Link href="/" className="af-button-secondary inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold">Back home</Link>
      </div>
    </section>
  )
}
