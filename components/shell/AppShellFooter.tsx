import Link from 'next/link'

const SHELL_FOOTER_LINKS = [
  { href: '/war-room', label: 'AF Legacy', accent: true },
  { href: '/ai/tools', label: 'Intelligence Hub', accent: false },
  { href: '/af-rankings', label: 'Rankings', accent: false },
  { href: '/find-league', label: 'Find League', accent: false },
  { href: '/privacy', label: 'Privacy', accent: false },
]

export default function AppShellFooter() {
  return (
    <footer
      className="mt-8 border-t pb-28 pt-6 lg:pb-6"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Mission line */}
        <p
          className="mb-4 max-w-lg text-xs leading-relaxed"
          style={{ color: 'var(--muted2)', opacity: 0.7 }}
        >
          Draft smarter. Manage better. Build your fantasy legacy. AllFantasy is not a sportsbook and does not offer gambling services.
        </p>

        {/* Quick links */}
        <nav
          className="flex flex-wrap items-center gap-x-5 gap-y-2"
          aria-label="App footer navigation"
        >
          {SHELL_FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs font-medium transition-opacity hover:opacity-100"
              style={{
                color: link.accent ? 'var(--accent-cyan-strong)' : 'var(--muted)',
                opacity: link.accent ? 1 : 0.8,
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Copyright */}
        <p
          className="mt-4 text-[11px]"
          style={{ color: 'var(--muted2)', opacity: 0.5 }}
        >
          © {new Date().getFullYear()} AllFantasy.ai
        </p>
      </div>
    </footer>
  )
}
