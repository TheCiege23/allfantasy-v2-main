import type { ReactNode } from "react"
import { CFP_BOWL_CREST_NAMES, type CfpBowlCrestKey } from "@/lib/playoffs/cfpBowlCrest"

/*
 * Original AllFantasy crests for the CFP bowls — NOT the bowls' official marks
 * (see lib/playoffs/cfpBowlCrest.ts). Each shield carries its own dark fill so it
 * reads the same on the dark, light and AF themes.
 */

const SHIELD = "M60 4 L112 20 V68 C112 102 88 124 60 136 C32 124 8 102 8 68 V20 Z"
const LEAF = "#3CCB7F"

const CRESTS: Record<CfpBowlCrestKey, { color: string; word: string; art: ReactNode }> = {
  rose: {
    color: "#F0506E",
    word: "ROSE",
    art: <>
      <circle cx="60" cy="58" r="23" fill="#F0506E" fillOpacity="0.18" stroke="#F0506E" strokeWidth="4" />
      <path d="M60 40 C73 45 76 62 63 69 C52 74 45 64 53 57 C57 54 63 57 61 62" fill="none" stroke="#F0506E" strokeWidth="4" strokeLinecap="round" />
      <path d="M60 81 V100" stroke={LEAF} strokeWidth="4" strokeLinecap="round" />
      <path d="M60 92 C50 86 44 90 42 96 C50 99 56 97 60 92 Z" fill={LEAF} />
      <path d="M60 88 C70 82 76 86 78 92 C70 95 64 93 60 88 Z" fill={LEAF} />
    </>,
  },
  cotton: {
    color: "#6FA3FF",
    word: "COTTON",
    art: <>
      <circle cx="46" cy="60" r="14" fill="#F4F7FF" />
      <circle cx="74" cy="60" r="14" fill="#F4F7FF" />
      <circle cx="60" cy="47" r="15" fill="#FFFFFF" />
      <circle cx="60" cy="66" r="13" fill="#E3EBFF" />
      <path d="M36 72 Q60 90 84 72" fill="none" stroke="#6FA3FF" strokeWidth="4" strokeLinecap="round" />
      <path d="M60 82 V102" stroke="#6FA3FF" strokeWidth="4" strokeLinecap="round" />
    </>,
  },
  fiesta: {
    color: "#FFB547",
    word: "FIESTA",
    art: <>
      <circle cx="60" cy="62" r="15" fill="#FFB547" />
      <g stroke="#FFB547" strokeWidth="4" strokeLinecap="round">
        <path d="M60 30 V40" /><path d="M60 84 V94" /><path d="M28 62 H38" /><path d="M82 62 H92" />
        <path d="M43 45 L37 39" /><path d="M77 45 L83 39" /><path d="M43 79 L37 85" /><path d="M77 79 L83 85" />
      </g>
      <path d="M30 102 L44 92 L54 99 L66 88 L90 102 Z" fill="#E0663A" />
    </>,
  },
  peach: {
    color: "#FF9A76",
    word: "PEACH",
    art: <>
      <path d="M60 50 C41 40 30 61 36 77 C42 93 56 98 60 96 C64 98 78 93 84 77 C90 61 79 40 60 50 Z" fill="#FF9A76" />
      <path d="M60 53 C54 65 56 82 60 93" fill="none" stroke="#D9684A" strokeWidth="3" strokeLinecap="round" />
      <path d="M60 50 C62 39 71 34 80 36 C76 46 68 50 60 50 Z" fill={LEAF} />
      <path d="M60 50 V42" stroke="#8A5A3C" strokeWidth="3" strokeLinecap="round" />
    </>,
  },
  orange: {
    color: "#2FC7A0",
    word: "ORANGE",
    art: <>
      <circle cx="60" cy="64" r="29" fill="#FF8A1F" />
      <circle cx="60" cy="64" r="23" fill="#FFC76B" />
      <g stroke="#FF8A1F" strokeWidth="3" strokeLinecap="round">
        <path d="M60 64 V41" /><path d="M60 64 V87" /><path d="M60 64 L40 52" /><path d="M60 64 L80 52" /><path d="M60 64 L40 76" /><path d="M60 64 L80 76" />
      </g>
      <circle cx="60" cy="64" r="3.5" fill="#FFF3D6" />
    </>,
  },
  sugar: {
    color: "#B794F6",
    word: "SUGAR",
    art: <>
      <path d="M60 40 L85 53 L60 66 L35 53 Z" fill="#EDE3FF" />
      <path d="M35 53 L60 66 V95 L35 82 Z" fill="#B794F6" />
      <path d="M85 53 L60 66 V95 L85 82 Z" fill="#8C6AD6" />
      <path d="M88 34 L90 40 L96 42 L90 44 L88 50 L86 44 L80 42 L86 40 Z" fill="#EDE3FF" />
    </>,
  },
  title: {
    color: "#F5C76B",
    word: "TITLE",
    art: <>
      <path d="M42 40 H78 V56 C78 70 70 78 60 78 C50 78 42 70 42 56 Z" fill="#F5C76B" />
      <path d="M42 46 C30 46 30 64 44 64" fill="none" stroke="#F5C76B" strokeWidth="4" strokeLinecap="round" />
      <path d="M78 46 C90 46 90 64 76 64" fill="none" stroke="#F5C76B" strokeWidth="4" strokeLinecap="round" />
      <path d="M56 78 H64 V90 H56 Z" fill="#D9A84A" />
      <path d="M45 90 H75 V99 H45 Z" fill="#F5C76B" />
      <path d="M60 46 L62.5 52 L69 52.5 L64 56.5 L65.5 63 L60 59.5 L54.5 63 L56 56.5 L51 52.5 L57.5 52 Z" fill="#111A2E" />
    </>,
  },
}

export default function CfpBowlCrest({ bowl, size = 40, decorative = false }: { bowl: CfpBowlCrestKey; size?: number; decorative?: boolean }) {
  const crest = CRESTS[bowl]
  const label = `${CFP_BOWL_CREST_NAMES[bowl]} crest`
  return (
    <svg
      className="af-pb-crest"
      data-bowl={bowl}
      width={size}
      height={Math.round(size * 140 / 120)}
      viewBox="0 0 120 140"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      focusable="false"
    >
      <path d={SHIELD} fill="#111A2E" stroke={crest.color} strokeWidth="5" />
      {bowl === "title"
        ? <path d="M14 24 L60 10 L106 24" fill="none" stroke="#5EE6D3" strokeWidth="3" />
        : <path d="M22 27 L60 15 L98 27" fill="none" stroke={crest.color} strokeWidth="2.5" strokeOpacity="0.55" />}
      {crest.art}
      {size >= 56 ? <text x="60" y="121" textAnchor="middle" fontSize="11" fontWeight="800" letterSpacing="1.5" fill={crest.color}>{crest.word}</text> : null}
    </svg>
  )
}
