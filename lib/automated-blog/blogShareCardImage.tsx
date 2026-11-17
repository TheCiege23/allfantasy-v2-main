import { ImageResponse } from 'next/og'

export const BLOG_SHARE_CARD_SIZE = { width: 1200, height: 630 } as const

/**
 * The 1200×630 share card for a blog post: the post's title on the brand background, with its
 * sport and category above it. Pure drawing, no data access, so the route stays a thin loader and
 * the card can be rendered on its own to look at.
 */
export function renderBlogShareCard(title: string, label: string): ImageResponse {
  // Long titles step down a size rather than spilling off the card.
  const titleSize = title.length > 60 ? 60 : 72
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: 'linear-gradient(135deg, #020617 0%, #0b1a33 60%, #082f49 100%)',
          color: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 800, letterSpacing: -0.5 }}>
          <span style={{ color: '#22d3ee' }}>All</span>
          <span>Fantasy</span>
          <span style={{ marginLeft: 18, fontSize: 24, fontWeight: 600, color: '#94a3b8' }}>Blog</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {label ? (
            <div
              style={{
                display: 'flex',
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: '#22d3ee',
                marginBottom: 20,
              }}
            >
              {label}
            </div>
          ) : null}
          <div style={{ display: 'flex', fontSize: titleSize, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 }}>
            {title}
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#94a3b8' }}>allfantasy.ai</div>
      </div>
    ),
    BLOG_SHARE_CARD_SIZE,
  )
}
