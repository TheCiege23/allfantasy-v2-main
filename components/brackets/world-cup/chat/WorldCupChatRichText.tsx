"use client"

/**
 * Renders World Cup chat rich text (lib/world-cup/worldCupChatRichText.ts): bold, italic, underline,
 * strike, an allow-listed colour and font. Text only — the parser never yields markup, so a message
 * cannot inject HTML.
 *
 * Shared by the composer's preview (WorldCupBracketShell) and the message bubbles
 * (./WorldCupChatMessageBubble). The bubbles were split out of the shell without it and showed
 * every formatted message as raw `**Bold** [color=…]` codes.
 */
import {
  parseWorldCupChatRichText,
  type WorldCupChatColor,
  type WorldCupChatFont,
  type WorldCupChatRichTextSegment,
} from "@/lib/world-cup/worldCupChatRichText"

function getWorldCupRichTextClassName(segment: WorldCupChatRichTextSegment) {
  const colorClass: Record<WorldCupChatColor, string> = {
    default: "",
    "af-blue": "text-white/85",
    red: "text-white/85",
    amber: "text-white/75",
    green: "text-white/85",
    purple: "text-purple-200",
  }
  const fontClass: Record<WorldCupChatFont, string> = {
    default: "",
    clean: "font-sans tracking-normal",
    sport: "font-black uppercase tracking-wide",
    mono: "font-mono",
  }

  return [
    segment.marks.bold ? "font-black" : "",
    segment.marks.italic ? "italic" : "",
    segment.marks.underline ? "underline underline-offset-2" : "",
    segment.marks.strike ? "line-through" : "",
    colorClass[segment.marks.color ?? "default"],
    fontClass[segment.marks.font ?? "default"],
  ].filter(Boolean).join(" ")
}

export function WorldCupChatRichTextSegments({
  segments,
  className,
}: {
  segments: WorldCupChatRichTextSegment[]
  className?: string
}) {
  return (
    <p className={className} dir="auto">
      {segments.map((segment, index) => (
        <span key={`${segment.text}-${index}`} className={getWorldCupRichTextClassName(segment)}>
          {segment.text}
        </span>
      ))}
    </p>
  )
}

export function WorldCupChatRichTextRenderer({ text, className }: { text: string; className?: string }) {
  return <WorldCupChatRichTextSegments segments={parseWorldCupChatRichText(text)} className={className} />
}
