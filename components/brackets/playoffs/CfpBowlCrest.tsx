import type { ReactNode } from "react"
import { CFP_BOWL_CREST_NAMES, type CfpBowlCrestKey } from "@/lib/playoffs/cfpBowlCrest"
import { RIVALRY_NAMES, type RivalryCrestKey } from "@/lib/college/rivalryCrests"

/*
 * Original AllFantasy crests for the CFP bowls and the big college rivalry games —
 * NOT the bowls' official marks, a school's logo or a trophy's likeness (see
 * lib/playoffs/cfpBowlCrest.ts). Each shield carries its own dark fill so it reads
 * the same on the dark, light and AF themes.
 */

export type CollegeCrestKey = CfpBowlCrestKey | RivalryCrestKey

const CREST_NAMES: Record<CollegeCrestKey, string> = { ...CFP_BOWL_CREST_NAMES, ...RIVALRY_NAMES }

const SHIELD = "M60 4 L112 20 V68 C112 102 88 124 60 136 C32 124 8 102 8 68 V20 Z"
const LEAF = "#3CCB7F"

const CRESTS: Record<CollegeCrestKey, { color: string; word: string; art: ReactNode; wordSize?: number }> = {
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
  // ── Rivalry games ───────────────────────────────────────────────────
  iron: {
    color: "#B8BEC9",
    word: "IRON",
    art: <>
      <g stroke="#FF7A3D" strokeWidth="3.5" strokeLinecap="round"><path d="M56 54 L50 42" /><path d="M62 52 L64 38" /><path d="M68 55 L78 45" /></g>
      <path d="M30 62 H84 C84 70 78 74 70 74 V82 H78 V94 H42 V82 H50 V74 C42 74 34 70 30 62 Z" fill="#B8BEC9" />
      <path d="M84 62 L96 58 L86 68 Z" fill="#B8BEC9" />
      <path d="M30 62 H84" stroke="#E6E9EF" strokeWidth="3" />
    </>,
  },
  game: {
    color: "#E8EEF8",
    word: "THE GAME",
    art: <>
      <path d="M28 48 L52 66 L28 84" fill="none" stroke="#E8EEF8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M92 48 L68 66 L92 84" fill="none" stroke="#8E9BB5" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 56 L62.5 63 L70 64 L64 68.5 L66 76 L60 71.5 L54 76 L56 68.5 L50 64 L57.5 63 Z" fill="#FFB547" />
    </>,
  },
  river: {
    color: "#E5484D",
    word: "RED RIVER",
    wordSize: 10,
    art: <>
      <path d="M60 36 L63 45 L72 45.5 L65 51 L67.5 60 L60 55 L52.5 60 L55 51 L48 45.5 L57 45 Z" fill="#F4F7FF" />
      <path d="M24 76 C38 62 50 90 62 76 C74 62 84 86 96 72" fill="none" stroke="#E5484D" strokeWidth="9" strokeLinecap="round" />
      <path d="M26 94 C40 84 52 100 64 92 C76 84 86 98 94 90" fill="none" stroke="#E5484D" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.5" />
    </>,
  },
  egg: {
    color: "#E9C46A",
    word: "EGG",
    art: <>
      <path d="M60 38 C74 38 83 60 83 75 C83 90 73 99 60 99 C47 99 37 90 37 75 C37 60 46 38 60 38 Z" fill="#E9C46A" />
      <path d="M50 52 C46 58 44 66 45 72" fill="none" stroke="#FFF1C9" strokeWidth="4" strokeLinecap="round" />
      <path d="M38 80 L48 74 L56 82 L64 74 L72 82 L82 76" fill="none" stroke="#B8902F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>,
  },
  service: {
    color: "#6C8EBF",
    word: "ARMY–NAVY",
    wordSize: 10,
    art: <>
      <g fill="none" stroke="#6C8EBF" strokeWidth="5" strokeLinecap="round">
        <circle cx="60" cy="44" r="6" />
        <path d="M60 50 V96" />
        <path d="M46 58 H74" />
        <path d="M36 80 C40 92 50 98 60 98 C70 98 80 92 84 80" />
      </g>
      <path d="M32 80 L36 72 L42 82 Z M88 80 L84 72 L78 82 Z" fill="#6C8EBF" />
      <path d="M88 34 L90 39.5 L96 40 L91.5 43.5 L93 49 L88 46 L83 49 L84.5 43.5 L80 40 L86 39.5 Z" fill="#F5C76B" />
      <path d="M32 34 L34 39.5 L40 40 L35.5 43.5 L37 49 L32 46 L27 49 L28.5 43.5 L24 40 L30 39.5 Z" fill="#F5C76B" />
    </>,
  },
  apple: {
    color: "#E4572E",
    word: "APPLE",
    art: <>
      <path d="M60 54 C46 42 32 54 34 72 C36 88 48 100 60 96 C72 100 84 88 86 72 C88 54 74 42 60 54 Z" fill="#E4572E" />
      <path d="M60 54 C60 46 62 40 66 36" fill="none" stroke="#8A5A3C" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M62 46 C68 36 80 36 84 40 C78 48 70 50 62 46 Z" fill={LEAF} />
      <path d="M44 64 C42 70 42 76 44 80" fill="none" stroke="#FFB59E" strokeWidth="3.5" strokeLinecap="round" />
    </>,
  },
  holy: {
    color: "#9C8AD6",
    word: "HOLY WAR",
    art: <>
      <path d="M24 98 L48 56 L60 74 L72 50 L96 98 Z" fill="#9C8AD6" />
      <path d="M48 56 L55 68 L50 66 L46 70 L41 68 Z" fill="#F4F7FF" />
      <path d="M72 50 L80 64 L75 62 L71 66 L66 63 Z" fill="#F4F7FF" />
      <path d="M28 98 H92" stroke="#6E5BB5" strokeWidth="3" />
    </>,
  },
  brawl: {
    color: "#7FB069",
    word: "BACKYARD",
    wordSize: 10,
    art: <>
      <path d="M30 58 L36 50 L42 58 V98 H30 Z M46 58 L52 50 L58 58 V98 H46 Z M62 58 L68 50 L74 58 V98 H62 Z M78 58 L84 50 L90 58 V98 H78 Z" fill="#7FB069" />
      <path d="M26 68 H94 V74 H26 Z M26 86 H94 V92 H26 Z" fill="#5E8C4C" />
    </>,
  },
}

export default function CfpBowlCrest({ bowl, size = 40, decorative = false }: { bowl: CollegeCrestKey; size?: number; decorative?: boolean }) {
  const crest = CRESTS[bowl]
  const label = `${CREST_NAMES[bowl]} crest`
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
      {size >= 56 ? <text x="60" y="121" textAnchor="middle" fontSize={crest.wordSize ?? 11} fontWeight="800" letterSpacing={crest.wordSize ? 1 : 1.5} fill={crest.color}>{crest.word}</text> : null}
    </svg>
  )
}
