import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Hammer } from 'lucide-react'
import './v3.css'

/**
 * Shared shell for the V3 marketing sub-pages linked from the landing page nav
 * and footer.
 *
 * Every destination linked from the homepage must resolve to a real page — a
 * 404 from the footer of a flagship marketing site reads as broken. Pages that
 * do not have finished content yet pass `status="building"`, which renders an
 * explicit, honest in-progress notice rather than thin filler pretending to be
 * a finished page. Do not remove that notice to make a page "look done"; write
 * the real content and drop the prop instead.
 */
export function V3PageShell({
  title,
  lead,
  status = 'ready',
  children,
}: {
  title: string
  lead: string
  /** 'building' renders the honest placeholder notice. */
  status?: 'ready' | 'building'
  children?: ReactNode
}) {
  return (
    <main className="afv3" style={{ minHeight: '100vh', overflowX: 'clip' }}>
      <div className="nav">
        <div className="wrap">
          <div className="nav-inner">
            <Link href="/" aria-label="AllFantasy home" style={{ display: 'flex', alignItems: 'center' }}>
              <Image
                src="/brand/allfantasy-wordmark-transparent.png"
                alt="AllFantasy"
                width={1198}
                height={306}
                priority
                style={{ height: 28, width: 'auto' }}
              />
            </Link>
            <div style={{ flex: 1 }} />
            <Link href="/" className="btn btn-ghost">
              <ArrowLeft size={16} /> Back to home
            </Link>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div className="glow" />
        <div className="wrap" style={{ position: 'relative', zIndex: 2, padding: '72px 0 40px', maxWidth: 860 }}>
          <h1 style={{ fontSize: 44, lineHeight: 1.06, marginBottom: 18 }}>{title}</h1>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--text-3)' }}>{lead}</p>
        </div>
      </div>

      <div className="wrap" style={{ paddingBottom: 80, maxWidth: 860 }}>
        {status === 'building' && (
          <div
            style={{
              display: 'flex',
              gap: 14,
              padding: '18px 20px',
              borderRadius: 'var(--r-lg)',
              border: '1px solid var(--line-purple)',
              background: 'var(--purple-dim)',
              marginBottom: 32,
            }}
          >
            <Hammer size={19} style={{ color: 'var(--purple-bright)', flex: 'none', marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>This page is still being built</div>
              <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6 }}>
                We linked it because it is on the way, and we would rather show you an honest placeholder than a dead
                link. If you need this now,{' '}
                <Link href="/contact" style={{ color: 'var(--purple-bright)' }}>
                  get in touch
                </Link>{' '}
                and we will help you directly.
              </p>
            </div>
          </div>
        )}

        {children}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 40 }}>
          <Link href="/" className="btn btn-primary">
            Back to home <ArrowRight size={16} />
          </Link>
          <Link href="/contact" className="btn btn-secondary">
            Contact us
          </Link>
        </div>
      </div>
    </main>
  )
}

/** Simple prose block used by the sub-pages that do have real content. */
export function V3Prose({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontSize: 15.5, lineHeight: 1.7, color: 'var(--text-2)' }}>
      {children}
    </div>
  )
}

export function V3Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <h2 style={{ fontSize: 22, marginBottom: 12 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 15.5, lineHeight: 1.7, color: 'var(--text-2)' }}>
        {children}
      </div>
    </section>
  )
}
