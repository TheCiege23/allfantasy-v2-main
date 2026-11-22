// The same card as og:image, so X/Twitter shows it too (the post's metadata uses a large-image card).
// Segment config is declared here rather than re-exported: Next reads it statically per file.
export { default } from './opengraph-image'

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'AllFantasy blog'
