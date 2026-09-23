import { Fragment, type ReactNode } from 'react'

/**
 * CHIMMY'S REPLY, FORMATTED — IN THE /core DRAWER THE MODEL'S MARKDOWN USED TO ARRIVE AS RAW
 * CHARACTERS. Every provider on the Chimmy path answers in Markdown (the prompt even asks for
 * headings), and the drawer printed it into a `pre-wrap` <p>, so users read `**Start him**`,
 * `---` and `- **Intent:**` literally. That, more than anything the model said, is what made
 * the answers look unfinished next to ChatGPT or Claude.
 *
 * ⚠ A DELIBERATE SUBSET, RENDERED AS REACT ELEMENTS — NEVER `dangerouslySetInnerHTML`. Model
 * text is untrusted (see `lib/chimmy-chat/safeChimmyLinks.ts`): no HTML passes through, and
 * Markdown LINKS are not rendered as links at all — `[label](href)` shows as its label. Adding
 * links later must go through `isRenderableChimmyContentHref`, never a raw href.
 *
 * Supported: paragraphs, single line breaks, `#`–`###` headings, `-`/`*`/`•` and `1.` lists,
 * `---` rules, `**bold**`, `*italic*`, and `` `code` ``. Anything else is text.
 */

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'rule' }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'p'; lines: string[] }

const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*$/
const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/
const UL_RE = /^[-*•]\s+(.+)$/
const OL_RE = /^\d{1,3}[.)]\s+(.+)$/

export function parseChimmyBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', lines: para })
    para = []
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = HEADING_RE.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', text: heading[1] })
      continue
    }
    if (RULE_RE.test(line)) {
      flush()
      blocks.push({ kind: 'rule' })
      continue
    }
    const ul = UL_RE.exec(line)
    const ol = ul ? null : OL_RE.exec(line)
    if (ul || ol) {
      flush()
      const kind = ul ? 'ul' : 'ol'
      const item = (ul ?? ol)![1]
      const last = blocks[blocks.length - 1]
      if (last && last.kind === kind) last.items.push(item)
      else blocks.push({ kind, items: [item] } as Block)
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

/*
 * No underscore emphasis on purpose: data slugs like `league_sports_grounding` appear in answers,
 * and `_x_` matching would italicise the middle of them.
 */
const INLINE_RE = /(\*\*[^*\n]+?\*\*|`[^`\n]+?`|\*[^*\s][^*\n]*?\*|\[[^\]\n]+?\]\([^)\n]*?\))/g

export function renderChimmyInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const token = m[0]
    const start = m.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const key = `i${i++}`
    if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('[')) {
      // Label only — see the header on links.
      out.push(token.slice(1, token.indexOf(']')))
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    last = start + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function ChimmyRichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseChimmyBlocks(text)
  return (
    <div className={className} data-rich="true">
      {blocks.map((b, bi) => {
        switch (b.kind) {
          case 'heading':
            return (
              <p key={bi} className="af-cm-rich-h">
                <strong>{renderChimmyInline(b.text)}</strong>
              </p>
            )
          case 'rule':
            return <hr key={bi} className="af-cm-rich-hr" />
          case 'ul':
            return (
              <ul key={bi}>
                {b.items.map((it, ii) => (
                  <li key={ii}>{renderChimmyInline(it)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={bi}>
                {b.items.map((it, ii) => (
                  <li key={ii}>{renderChimmyInline(it)}</li>
                ))}
              </ol>
            )
          default:
            return (
              <p key={bi}>
                {b.lines.map((ln, li) => (
                  <Fragment key={li}>
                    {li > 0 ? <br /> : null}
                    {renderChimmyInline(ln)}
                  </Fragment>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
