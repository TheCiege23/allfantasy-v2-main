// Minimal surface of opentype.js used by lib/survivor/tribeEmblemComposer.ts.
declare module 'opentype.js' {
  export interface GlyphPoint {
    x: number
    y: number
    onCurve: boolean
    lastPointOfContour?: boolean
  }
  export interface Glyph {
    index: number
    advanceWidth: number
    leftSideBearing?: number
    xMin?: number
    points?: GlyphPoint[]
    readonly path: unknown
  }
  export interface Font {
    unitsPerEm: number
    charToGlyphIndex(ch: string): number
    glyphs: { get(index: number): Glyph }
  }
  export function parse(buffer: ArrayBuffer): Font
  const opentype: { parse: typeof parse }
  export default opentype
}
