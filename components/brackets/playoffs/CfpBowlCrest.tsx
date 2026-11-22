import type { ReactNode } from "react"
import { CFP_BOWL_CREST_NAMES, type CfpBowlCrestKey } from "@/lib/playoffs/cfpBowlCrest"
import { RIVALRY_NAMES, type RivalryCrestKey } from "@/lib/college/rivalryCrests"

/*
 * Original AllFantasy crests for the CFP bowls and the big college rivalry games —
 * NOT the bowls' official marks, a school's logo or a trophy's likeness (see
 * lib/playoffs/cfpBowlCrest.ts). Each shield carries its own dark fill so it reads
 * the same on the dark, light and AF themes.
 */

type CollegeCrestKey = CfpBowlCrestKey | RivalryCrestKey

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
  flga: {
    color: "#F28C38",
    word: "FLA · UGA",
    wordSize: 9.5,
    art: <>
      <path d="M60 38 C80 44 86 66 76 78 C68 86 52 86 44 78 C34 66 40 44 60 38 Z" fill="#F28C38" transform="rotate(-35 60 62)" />
      <path d="M50 68 L70 56" stroke="#F4F7FF" strokeWidth="3" strokeLinecap="round" />
      <path d="M54 60 L57 65 M58 58 L61 63 M62 56 L65 61" stroke="#F4F7FF" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M26 96 Q34 90 42 96 T58 96 T74 96 T94 96" fill="none" stroke="#5EC2E6" strokeWidth="4" strokeLinecap="round" />
    </>,
  },
  hate: {
    color: "#FF5A36",
    word: "HATE",
    art: <>
      <path d="M60 34 C66 46 80 52 80 72 C80 88 70 98 60 98 C50 98 40 88 40 72 C40 60 48 56 50 46 C54 52 56 54 58 54 C58 46 58 40 60 34 Z" fill="#FF5A36" />
      <path d="M60 62 C64 70 70 74 70 82 C70 90 66 94 60 94 C54 94 50 90 50 82 C50 76 54 74 56 68 C58 72 59 72 60 62 Z" fill="#FFD84D" />
    </>,
  },
  palmetto: {
    color: "#5B7FD6",
    word: "PALMETTO",
    wordSize: 10,
    art: <>
      <path d="M36 36 A10 10 0 1 0 46 48 A8 8 0 1 1 36 36 Z" fill="#F4F7FF" />
      <path d="M64 98 V60" stroke="#F4F7FF" strokeWidth="5" strokeLinecap="round" />
      <g fill="none" stroke="#5B7FD6" strokeWidth="5" strokeLinecap="round">
        <path d="M64 60 C56 52 46 52 40 58" /><path d="M64 60 C72 52 82 52 88 58" /><path d="M64 60 C60 48 54 44 48 42" /><path d="M64 60 C68 48 74 44 80 42" /><path d="M64 60 V44" />
      </g>
      <path d="M44 98 H84" stroke="#5B7FD6" strokeWidth="3" strokeLinecap="round" />
    </>,
  },
  sunshine: {
    color: "#FFC233",
    word: "SUNSHINE",
    wordSize: 10,
    art: <>
      <g stroke="#FFC233" strokeWidth="3.5" strokeLinecap="round"><path d="M60 34 V42" /><path d="M38 44 L43 50" /><path d="M82 44 L77 50" /></g>
      <path d="M26 62 H94" stroke="#FFC233" strokeWidth="4" strokeLinecap="round" />
      <path d="M30 62 H56 V68 C56 78 50 84 42 84 C34 84 30 78 30 70 Z" fill="#FFC233" />
      <path d="M64 62 H90 V70 C90 78 86 84 78 84 C70 84 64 78 64 68 Z" fill="#FFC233" />
      <path d="M36 66 C40 66 44 68 46 72" fill="none" stroke="#FFF1C9" strokeWidth="3" strokeLinecap="round" />
      <path d="M70 66 C74 66 78 68 80 72" fill="none" stroke="#FFF1C9" strokeWidth="3" strokeLinecap="round" />
    </>,
  },
  lonestar: {
    color: "#C96B3C",
    word: "LONE STAR",
    wordSize: 10,
    art: <>
      <circle cx="60" cy="66" r="30" fill="none" stroke="#C96B3C" strokeWidth="4" strokeDasharray="7 5" />
      <path d="M60 40 L67 58 L86 58 L71 69 L77 88 L60 77 L43 88 L49 69 L34 58 L53 58 Z" fill="#F4F7FF" />
    </>,
  },
  territorial: {
    color: "#D17A3B",
    word: "TERRITORIAL",
    wordSize: 9,
    art: <>
      <path d="M24 92 L42 62 H56 L64 74 L74 56 H84 L96 92 Z" fill="#D17A3B" />
      <path d="M60 36 V100" stroke="#F4F7FF" strokeWidth="3" strokeDasharray="5 5" strokeLinecap="round" />
      <circle cx="40" cy="44" r="6" fill="#FFB547" />
    </>,
  },
  biggame: {
    color: "#F2C14E",
    word: "BIG GAME",
    art: <>
      <path d="M24 86 C34 66 46 62 56 72 C64 60 78 58 96 80 V98 H24 Z" fill="#F2C14E" />
      <path d="M30 54 H58 M42 46 H78 M62 58 H90" stroke="#C9D5EC" strokeWidth="3.5" strokeLinecap="round" strokeOpacity="0.8" />
      <path d="M24 92 Q40 86 60 92 T96 92" fill="none" stroke="#5EC2E6" strokeWidth="3" strokeLinecap="round" />
    </>,
  },
  coast: {
    color: "#D4AF37",
    word: "ND · USC",
    wordSize: 10,
    art: <>
      <path d="M30 84 C40 46 80 46 90 72" fill="none" stroke="#D4AF37" strokeWidth="4" strokeDasharray="6 5" strokeLinecap="round" />
      <circle cx="30" cy="84" r="7" fill="#E5484D" />
      <circle cx="90" cy="72" r="7" fill="#6FA3FF" />
      <path d="M60 40 L62.5 47 L70 47.5 L64 52 L66 59 L60 55 L54 59 L56 52 L50 47.5 L57.5 47 Z" fill="#D4AF37" />
      <path d="M26 98 H94" stroke="#D4AF37" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.6" />
    </>,
  },
  october: {
    color: "#F59E42",
    word: "3RD SAT",
    wordSize: 10,
    art: <>
      <path d="M30 42 H90 V96 H30 Z" fill="#E6E9EF" />
      <path d="M30 42 H90 V54 H30 Z" fill="#F59E42" />
      <path d="M42 36 V46 M78 36 V46" stroke="#E6E9EF" strokeWidth="4" strokeLinecap="round" />
      <g fill="#9AA8C2">
        <rect x="35" y="60" width="8" height="7" /><rect x="47" y="60" width="8" height="7" /><rect x="59" y="60" width="8" height="7" /><rect x="71" y="60" width="8" height="7" />
        <rect x="35" y="72" width="8" height="7" /><rect x="47" y="72" width="8" height="7" /><rect x="59" y="72" width="8" height="7" />
        <rect x="35" y="84" width="8" height="7" /><rect x="47" y="84" width="8" height="7" /><rect x="59" y="84" width="8" height="7" /><rect x="71" y="84" width="8" height="7" />
      </g>
      <rect x="69" y="70" width="12" height="11" rx="2" fill="#F59E42" />
    </>,
  },
  oak: {
    color: "#8DA05E",
    word: "OLDEST",
    wordSize: 9,
    art: <>
      <circle cx="44" cy="58" r="15" fill="#8DA05E" />
      <circle cx="76" cy="58" r="15" fill="#8DA05E" />
      <circle cx="60" cy="46" r="17" fill="#A3B872" />
      <circle cx="60" cy="64" r="14" fill="#8DA05E" />
      <path d="M56 98 C57 86 56 78 52 72 M64 98 C63 86 64 78 68 72 M56 98 H64 V76 H56 Z" fill="#8A5A3C" stroke="#8A5A3C" strokeWidth="3" strokeLinejoin="round" />
      <path d="M34 98 H86" stroke="#8DA05E" strokeWidth="3" strokeLinecap="round" />
    </>,
  },
  mitten: {
    color: "#9AA8FF",
    word: "MICH · MSU",
    wordSize: 9.5,
    art: <>
      <path d="M44 98 C38 86 38 66 44 52 C48 42 56 38 62 42 C66 46 64 54 62 60 C66 54 74 52 78 56 C82 62 80 70 78 76 C76 88 72 96 66 98 Z" fill="#9AA8FF" />
      <path d="M78 56 C84 50 90 52 90 58 C90 64 84 66 80 64" fill="#9AA8FF" />
      <circle cx="58" cy="80" r="4" fill="#111A2E" />
      <circle cx="70" cy="66" r="4" fill="#111A2E" />
      <path d="M58 80 L70 66" stroke="#111A2E" strokeWidth="2.5" strokeDasharray="3 3" />
    </>,
  },
  sunflower: {
    color: "#FFCC33",
    word: "SUNFLOWER",
    wordSize: 9.5,
    art: <>
      <path d="M60 76 V100" stroke={LEAF} strokeWidth="4" strokeLinecap="round" />
      <path d="M60 92 C52 86 46 88 42 94 C50 96 56 96 60 92 Z" fill={LEAF} />
      <g fill="#FFCC33">
        <ellipse cx="60" cy="38" rx="6" ry="10" /><ellipse cx="60" cy="74" rx="6" ry="10" /><ellipse cx="42" cy="56" rx="10" ry="6" /><ellipse cx="78" cy="56" rx="10" ry="6" />
        <ellipse cx="47" cy="43" rx="6" ry="10" transform="rotate(-45 47 43)" /><ellipse cx="73" cy="43" rx="6" ry="10" transform="rotate(45 73 43)" />
        <ellipse cx="47" cy="69" rx="6" ry="10" transform="rotate(45 47 69)" /><ellipse cx="73" cy="69" rx="6" ry="10" transform="rotate(-45 73 69)" />
      </g>
      <circle cx="60" cy="56" r="11" fill="#7A4E1E" />
    </>,
  },
  cyhawk: {
    color: "#E8C547",
    word: "CY-HAWK",
    art: <>
      <path d="M60 36 C70 36 74 50 74 66 C74 80 68 90 60 90 C52 90 46 80 46 66 C46 50 50 36 60 36 Z" fill="#E8C547" />
      <g stroke="#B8962E" strokeWidth="2"><path d="M50 50 H70" /><path d="M48 60 H72" /><path d="M48 70 H72" /><path d="M50 80 H70" /><path d="M60 38 V88" /></g>
      <path d="M60 98 C50 92 42 80 42 64 C46 74 52 82 60 86 Z" fill={LEAF} />
      <path d="M60 98 C70 92 78 80 78 64 C74 74 68 82 60 86 Z" fill="#2FA866" />
    </>,
  },
  governor: {
    color: "#6C9BD2",
    word: "GOVERNOR",
    wordSize: 9.5,
    art: <>
      <path d="M40 94 V64 C40 48 48 38 60 38 C72 38 80 48 80 64 V94 H68 V64 C68 56 64 50 60 50 C56 50 52 56 52 64 V94 Z" fill="#C9D5EC" />
      <g fill="#111A2E"><circle cx="46" cy="64" r="2.5" /><circle cx="74" cy="64" r="2.5" /><circle cx="46" cy="78" r="2.5" /><circle cx="74" cy="78" r="2.5" /><circle cx="50" cy="50" r="2.5" /><circle cx="70" cy="50" r="2.5" /></g>
      <path d="M28 100 Q44 94 60 100 T92 100" fill="none" stroke="#6C9BD2" strokeWidth="3" strokeLinecap="round" />
    </>,
  },
  ridge: {
    color: "#7E8CE0",
    word: "COMMONWEALTH",
    wordSize: 9,
    art: <>
      <circle cx="78" cy="46" r="7" fill="#FFB547" />
      <path d="M22 74 C34 60 44 58 56 66 C66 56 80 54 98 68 V100 H22 Z" fill="#4A56A6" />
      <path d="M22 86 C36 74 48 74 60 82 C72 72 84 72 98 82 V100 H22 Z" fill="#7E8CE0" />
      <path d="M22 96 C38 88 52 90 62 94 C74 88 86 88 98 94 V100 H22 Z" fill="#B3BCF0" />
    </>,
  },
  storm: {
    color: "#45C4B0",
    word: "MIA · FSU",
    wordSize: 9.5,
    art: <>
      <circle cx="60" cy="66" r="10" fill="#111A2E" stroke="#45C4B0" strokeWidth="5" />
      <path d="M70 66 C72 50 62 38 46 40" fill="none" stroke="#45C4B0" strokeWidth="6" strokeLinecap="round" />
      <path d="M50 66 C48 82 58 94 74 92" fill="none" stroke="#45C4B0" strokeWidth="6" strokeLinecap="round" />
      <circle cx="60" cy="66" r="3" fill="#F4F7FF" />
    </>,
  },
  valley: {
    color: "#2E9E6A",
    word: "UO · OSU",
    wordSize: 9.5,
    art: <>
      <path d="M60 34 L76 58 H68 L82 78 H66 V88 H54 V78 H38 L52 58 H44 Z" fill="#2E9E6A" />
      <path d="M24 98 C40 90 52 102 66 94 C78 88 88 96 96 92" fill="none" stroke="#5EC2E6" strokeWidth="4" strokeLinecap="round" />
    </>,
  },
  northwoods: {
    color: "#6FA0C8",
    word: "WIS · MINN",
    wordSize: 9.5,
    art: <>
      <circle cx="84" cy="40" r="6" fill="#F4F7FF" />
      <path d="M42 38 L55 62 H49 L60 82 H24 L35 62 H29 Z" fill="#4C9A6E" />
      <path d="M76 48 L86 64 H81 L90 80 H62 L71 64 H66 Z" fill="#3E8460" />
      <path d="M24 92 Q34 86 44 92 T64 92 T84 92 T96 92" fill="none" stroke="#6FA0C8" strokeWidth="4" strokeLinecap="round" />
      <path d="M30 100 Q40 96 50 100 T70 100 T90 100" fill="none" stroke="#6FA0C8" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.6" />
    </>,
  },
  oaken: {
    color: "#C9963F",
    word: "IU · PUR",
    wordSize: 9.5,
    art: <>
      <path d="M60 46 V38" stroke="#8A5A3C" strokeWidth="4" strokeLinecap="round" />
      <path d="M44 60 C44 46 76 46 76 60 Z" fill="#8A5A3C" />
      <path d="M44 60 H76" stroke="#6E4630" strokeWidth="3" />
      <path d="M47 60 C47 80 54 92 60 94 C66 92 73 80 73 60 Z" fill="#C9963F" />
      <path d="M66 40 C74 32 86 34 90 40 C82 44 74 44 66 40 Z" fill={LEAF} />
    </>,
  },
  barn: {
    color: "#C9473F",
    word: "IOWA · MINN",
    wordSize: 9.5,
    art: <>
      <path d="M32 98 V64 L60 42 L88 64 V98 Z" fill="#C9473F" />
      <path d="M32 64 L60 42 L88 64" fill="none" stroke="#F4F7FF" strokeWidth="3" strokeLinejoin="round" />
      <path d="M54 54 H66 V62 H54 Z" fill="#F4F7FF" />
      <path d="M50 98 V74 H70 V98 Z" fill="#F4F7FF" />
      <path d="M50 74 L70 98 M70 74 L50 98" stroke="#C9473F" strokeWidth="2.5" />
    </>,
  },
  road: {
    color: "#7FB2E5",
    word: "TOBACCO RD",
    wordSize: 9.5,
    art: <>
      <path d="M22 50 H98" stroke="#7FB2E5" strokeWidth="2.5" strokeOpacity="0.7" />
      <path d="M22 50 H58 L36 100 H22 Z" fill="#2D5BA8" />
      <path d="M98 50 H62 L84 100 H98 Z" fill="#7FB2E5" />
      <path d="M58 50 H62 L84 100 H36 Z" fill="#2B3245" />
      <path d="M60 56 V62 M60 70 V78 M60 86 V96" stroke="#FFD84D" strokeWidth="3" strokeLinecap="round" />
    </>,
  },
  magnolia: {
    color: "#E6D6A8",
    word: "MAGNOLIA",
    wordSize: 9.5,
    art: <>
      <path d="M30 90 C38 78 50 78 56 86 C48 94 38 96 30 90 Z M90 90 C82 78 70 78 64 86 C72 94 82 96 90 90 Z" fill="#2F7D4F" />
      <ellipse cx="60" cy="50" rx="10" ry="18" fill="#FBF7EA" />
      <ellipse cx="44" cy="64" rx="10" ry="18" fill="#F4EDD6" transform="rotate(-55 44 64)" />
      <ellipse cx="76" cy="64" rx="10" ry="18" fill="#F4EDD6" transform="rotate(55 76 64)" />
      <ellipse cx="50" cy="78" rx="9" ry="15" fill="#FBF7EA" transform="rotate(-20 50 78)" />
      <ellipse cx="70" cy="78" rx="9" ry="15" fill="#FBF7EA" transform="rotate(20 70 78)" />
      <circle cx="60" cy="68" r="7" fill="#C9963F" />
    </>,
  },
  lights: {
    color: "#FFE07A",
    word: "LSU · BAMA",
    wordSize: 9.5,
    art: <>
      <path d="M50 52 L28 92 H44 Z M70 52 L92 92 H76 Z" fill="#FFE07A" fillOpacity="0.22" />
      <path d="M44 36 H76 V52 H44 Z" fill="#E6E9EF" />
      <g fill="#FFE07A">
        <rect x="47" y="39" width="6" height="4" /><rect x="57" y="39" width="6" height="4" /><rect x="67" y="39" width="6" height="4" />
        <rect x="47" y="45" width="6" height="4" /><rect x="57" y="45" width="6" height="4" /><rect x="67" y="45" width="6" height="4" />
      </g>
      <path d="M60 52 V98 M52 98 H68" stroke="#E6E9EF" strokeWidth="4" strokeLinecap="round" />
      <path d="M56 62 L64 70 M64 62 L56 70 M56 76 L64 84 M64 76 L56 84" stroke="#9AA8C2" strokeWidth="2" />
    </>,
  },
  wings: {
    color: "#8FB3E0",
    word: "AF · NAVY",
    wordSize: 9.5,
    art: <>
      <path d="M56 54 C44 46 30 46 18 50 C28 54 38 56 46 60 C36 60 28 62 22 66 C34 68 46 66 56 62 Z" fill="#C9D5EC" />
      <path d="M64 54 C76 46 90 46 102 50 C92 54 82 56 74 60 C84 60 92 62 98 66 C86 68 74 66 64 62 Z" fill="#C9D5EC" />
      <path d="M60 44 L64 55 L76 55 L66.5 62 L70 73 L60 66.5 L50 73 L53.5 62 L44 55 L56 55 Z" fill="#8FB3E0" />
      <g fill="none" stroke="#8FB3E0" strokeWidth="3.5" strokeLinecap="round"><path d="M60 76 V98" /><path d="M52 82 H68" /><path d="M46 92 C50 98 56 100 60 100 C64 100 70 98 74 92" /></g>
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
