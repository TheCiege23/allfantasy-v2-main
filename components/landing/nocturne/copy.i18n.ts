/**
 * Locale copy for the Nocturne landing page.
 *
 * English lives in `./copy.ts` (the canonical shape). Each locale below implements
 * the `NocturneCopy` interface, so a missing/renamed field is a compile error — the
 * shapes cannot silently drift. `getNocturneCopy(lang)` picks the active locale and
 * falls back to English for anything not translated here (e.g. fr/ar, still
 * "future-only" app-wide).
 *
 * These are first-pass translations (es/zh/fil/vi) intended to make the page render
 * in each language; a native review pass is worthwhile before treating any as final
 * — matching the app's own "partial"/"beta" language-support status.
 *
 * Kept in English on purpose: brand and proper nouns (AllFantasy, Sleeper, ESPN,
 * Yahoo, MFL, Fantrax), tier names (AF Pro / Commissioner / AF Supreme / AF Legacy),
 * sport codes, and the illustrative mockup league names. No customer-facing "AI" in
 * any locale.
 *
 * 🛑 PRICES ARE NOT TYPED HERE. They come from `planPrice(sku)` (catalog-backed, see
 * ./copy.ts) — four locales of hand-typed prices had drifted from what checkout charges.
 */

import { NOCTURNE_COPY, PRO_CHIMMY_DAILY, planPrice, type NocturneCopy } from './copy'
import type { LanguageCode } from '@/lib/i18n/constants'

// ── Spanish ──────────────────────────────────────────────────────────────────
const es: NocturneCopy = {
  nav: {
    features: 'Funciones',
    howItWorks: 'Cómo funciona',
    forCommissioners: 'Para comisionados',
    signIn: 'Iniciar sesión',
    getStarted: 'Empieza gratis',
    getStartedShort: 'Empezar',
    ariaHome: 'Inicio de AllFantasy',
    ariaPrimaryNav: 'Principal',
    ariaFooterNav: 'Pie de página',
  },
  hero: {
    badge: 'Solo fantasy · Sin apuestas · Todas las ligas gratis',
    titleTop: 'Cada liga que juegas.',
    titleAccent: 'Una pantalla.',
    body:
      'Reúne Sleeper, ESPN, Yahoo y más en un solo centro de control que te muestra qué necesita tu atención, a quién alinear y adónde ir — en todas tus ligas a la vez.',
    primary: 'Empieza gratis',
    secondary: 'Mira cómo funciona',
    finePrint: `Crea, importa y dirige ligas gratis · Planes de pago desde ${planPrice('af_pro_monthly')}/mes · Cancela cuando quieras`,
    mockup: {
      title: 'Tus ligas',
      clock: 'Semana 12 · Dom 11:41',
      rows: [
        { initial: 'S', color: '#1f2a4d', name: 'Dynasty Dragons', sub: 'Sleeper · Dynasty PPR', score: '96.2', opp: '–88.4', tag: 'Ajusta el flex', tagIcon: 'alert', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'Gridiron Gang', sub: 'ESPN · 0.5 PPR', score: '74.0', opp: '–91.6', tag: 'Waiver hoy', tagIcon: 'bell', tagKind: 'accent' },
        { initial: 'Y', color: '#3a1d55', name: 'Waiver Warriors', sub: 'Yahoo · Standard', score: '110.8', opp: '–102.1', tag: 'Cambio', tagIcon: 'trade', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'End Zone Elites', sub: 'ESPN · Keeper', score: '88.4', opp: '–71.9', tag: 'Todo listo', tagIcon: 'check', tagKind: 'neutral' },
      ],
      lockedTitle: 'Ventaja proyectada esta semana',
      lockedSub: 'En tus 4 ligas',
      lockedValue: '+14.6',
      lockedTag: 'AF Pro',
    },
  },
  stats: {
    items: [
      { value: '6', label: 'Deportes cubiertos' },
      { value: '13+', label: 'Formatos de liga' },
      { value: '3', label: 'Plataformas activas' },
      { value: 'En vivo', label: 'Marcador y novedades' },
    ],
    sports: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAA', 'Soccer'],
  },
  features: {
    kicker: 'Lo que obtienes',
    rows: [
      {
        index: '01',
        title: ['Todas tus ligas,', 'un tablero.'],
        body:
          'Sleeper, ESPN y Yahoo — importadas con tus plantillas e historial reales; MFL y Fantrax llegan pronto. Deja de saltar entre apps; empieza tu domingo en un solo lugar.',
      },
      {
        index: '02',
        title: ['Sabe qué necesita', 'tu atención.'],
        body:
          'En todas tus ligas a la vez: alineaciones sin definir, waivers de hoy, cambios que te esperan — cada uno etiquetado con la liga y exactamente qué hacer.',
      },
      {
        index: '03',
        title: ['Cada jugador,', 'cada liga.'],
        body:
          'Busca cualquier jugador y ve al instante todos los equipos donde lo tienes, con estadísticas, lesiones y noticias reales de datos deportivos en vivo — nunca un número inventado disfrazado de hecho.',
      },
    ],
  },
  howItWorks: {
    kicker: 'Cómo funciona',
    cards: [
      {
        icon: 'link',
        title: '1 · Conecta tus ligas',
        body:
          'Enlaza Sleeper, ESPN o Yahoo en segundos — MFL y Fantrax llegan pronto. Traemos tus plantillas, enfrentamientos e historial reales — sin configuración manual.',
      },
      {
        icon: 'eye',
        title: '2 · Ve todo',
        body:
          'Cada liga aparece en un solo tablero. Tus equipos, tus enfrentamientos, tus jugadores — lado a lado, por fin.',
      },
      {
        icon: 'cursor',
        title: '3 · Sabe qué hacer',
        body:
          'AllFantasy lee todas tus ligas y señala qué necesita atención — la alineación sin definir, el objetivo de waiver, el cambio que vale la pena. Tú decides; te muestra el camino.',
      },
    ],
  },
  commissioner: {
    kicker: 'Para comisionados',
    titleTop: 'Dirige tu liga.',
    titleBottom: 'Ve todas las demás.',
    bodyLead:
      'Los comisionados hacen el mayor trabajo y reciben la menor ayuda. Ten las herramientas para dirigir tu liga — invitaciones, ajustes, enfrentamientos, clasificaciones, análisis — mientras cada ',
    bodyEm: 'otra',
    bodyTail: ' liga que juegas se une al mismo centro de control.',
    cta: 'Trae tu liga',
    cards: [
      { icon: 'shuffle', title: 'Draft de dispersión', body: '¿Se van mánagers? Junta sus activos y corre un draft en vivo — automáticamente.' },
      { icon: 'shield', title: 'Monitoreo de integridad', body: 'Cada cambio recibe una revisión discreta de equidad. El anti-tanking opcional lo mantiene real.' },
      { icon: 'dice', title: 'Lotería ponderada', body: 'Orden de draft estilo NBA para dynasty. Elimina el tanking sin quitar la diversión.' },
      { icon: 'broadcast', title: 'Difusión de liga', body: 'Envía anuncios, encuestas y eventos a todas tus ligas a la vez.' },
    ],
  },
  pricing: {
    kicker: 'Precios simples',
    title: 'Todas las ligas son gratis. Mejora para tener ventaja.',
    body:
      'Crea, importa y dirige todas las ligas que quieras — drafts, cambios, waivers, marcadores en vivo y clasificaciones incluidos, gratis para siempre. Elige Pro para Chimmy y herramientas de jugador, Commissioner para automatización e integridad de liga, o Supreme para ambos.',
    footnote: 'Los planes de pago se facturan mensual o anualmente. Cancela cuando quieras desde Configuración → Facturación.',
    tiers: [
      {
        key: 'free', name: 'Gratis', price: '$0', priceSuffix: 'para siempre', priceYear: null,
        plan: null, featured: false, badge: null, cta: 'Empieza gratis',
        features: [
          { text: 'Crea e importa ligas ilimitadas' },
          { text: 'Drafts, cambios, waivers y marcadores en vivo' },
          { text: 'Todas tus ligas en un tablero' },
          { text: 'Lo básico del comisionado: ajustes, invitaciones y playoffs' },
        ],
      },
      {
        key: 'pro', name: 'AF Pro', price: planPrice('af_pro_monthly'), priceSuffix: '/ mes', priceYear: `o ${planPrice('af_pro_yearly')}/año`,
        plan: 'pro', featured: false, badge: null, cta: 'Obtén AF Pro',
        features: [
          { text: 'Todo lo de Gratis' },
          { text: `Chimmy: ${PRO_CHIMMY_DAILY} respuestas al día` },
          { text: 'Herramientas de cambios y waivers' },
          { text: 'Guía de alineación y start/sit' },
        ],
      },
      {
        key: 'commissioner', name: 'Commissioner', price: planPrice('af_commissioner_monthly'), priceSuffix: '/ mes', priceYear: `o ${planPrice('af_commissioner_yearly')}/año`,
        plan: 'commissioner', featured: false, badge: null, cta: 'Obtén Commissioner',
        features: [
          { text: 'Todo lo de Gratis' },
          { text: 'Automatización de liga y tablas de puntuación personalizadas' },
          { text: 'Monitoreo de integridad y salud de la liga' },
          { text: 'Resúmenes, power rankings e historias' },
        ],
      },
      {
        key: 'supreme', name: 'AF Supreme', price: planPrice('af_supreme_monthly'), priceSuffix: '/ mes', priceYear: `o ${planPrice('af_supreme_yearly')}/año`,
        plan: 'supreme', featured: true, badge: 'Mejor valor', cta: 'Obtén AF Supreme',
        features: [
          { text: 'Todo lo de AF Pro y Commissioner' },
          { text: 'Herramientas de planificación dynasty y devy' },
          { text: 'Cuesta menos que comprar ambos' },
          { text: 'Para comisionados que también juegan' },
        ],
      },
    ],
  },
  finalCta: {
    title: 'Toda tu vida fantasy, en un solo lugar.',
    body:
      'El acceso anticipado está llegando a mánagers y comisionados ahora. Gratis para empezar — sin apuestas, sin DFS, solo la vista más clara de cada liga que juegas.',
    primary: 'Empieza gratis',
    secondary: 'Crea una liga',
  },
  importFlow: {
    kicker: 'Conecta tu liga a AllFantasy',
    title: 'Conecta tu liga en segundos.',
    body:
      'Elige tu plataforma y escribe tu usuario de Sleeper o ID de liga. Crea una cuenta gratis y construimos una copia de solo lectura de tus equipos, enfrentamientos y puntuación reales — AllFantasy analiza tu liga pero nunca cambia nada en la plataforma externa.',
    submitFull: 'Conecta mi liga',
    submitMini: 'Conectar',
    miniLabel: 'Conecta tu liga',
    importing: 'Llevándote a conectar tu liga…',
    teaserCaption: 'Tus ligas reales aparecen aquí',
    trustNote: 'Crea una cuenta gratis para conectar tu liga de {label} — solo lectura, sin contraseña, nunca.',
    nonSleeperNote: 'Crea una cuenta gratis para terminar de conectar {label} — sin contraseña, nunca.',
    accountNote: 'Crea una cuenta gratis y luego inicia sesión con {label} — listamos tus ligas por ti, sin ID de liga. Solo lectura.',
    comingSoonNote: '{label} aún no está disponible — próximamente.',
    platformSoon: 'Próximamente',
  },
  footer: {
    copyright: '© 2026 AllFantasy.ai',
    privacy: 'Privacidad',
    terms: 'Términos',
    dataDeletion: 'Eliminación de datos',
    signIn: 'Iniciar sesión',
    geoNote:
      'No disponible en WA. Ligas de pago restringidas en HI, ID, MT, NV. AllFantasy es 100% fantasy — sin apuestas, sin casa de apuestas.',
  },
}

// ── Chinese (Simplified) ─────────────────────────────────────────────────────
const zh: NocturneCopy = {
  nav: {
    features: '功能',
    howItWorks: '使用方法',
    forCommissioners: '给联盟管理员',
    signIn: '登录',
    getStarted: '免费开始',
    getStartedShort: '开始',
    ariaHome: 'AllFantasy 首页',
    ariaPrimaryNav: '主导航',
    ariaFooterNav: '页脚',
  },
  hero: {
    badge: '仅限梦幻体育 · 无博彩 · 所有联盟免费',
    titleTop: '你参加的每个联盟。',
    titleAccent: '一块屏幕。',
    body:
      '把 Sleeper、ESPN、Yahoo 等联盟汇聚到一个指挥中心，一眼看清哪些需要你处理、该派谁上场、下一步去哪——同时管理你的所有联盟。',
    primary: '免费开始',
    secondary: '看看怎么用',
    finePrint: `免费创建、导入和运营联盟 · 付费方案每月 ${planPrice('af_pro_monthly')} 起 · 随时取消`,
    mockup: {
      title: '你的联盟',
      clock: '第 12 周 · 周日 11:41',
      rows: [
        { initial: 'S', color: '#1f2a4d', name: 'Dynasty Dragons', sub: 'Sleeper · Dynasty PPR', score: '96.2', opp: '–88.4', tag: '设置 flex', tagIcon: 'alert', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'Gridiron Gang', sub: 'ESPN · 0.5 PPR', score: '74.0', opp: '–91.6', tag: '今日 waiver', tagIcon: 'bell', tagKind: 'accent' },
        { initial: 'Y', color: '#3a1d55', name: 'Waiver Warriors', sub: 'Yahoo · Standard', score: '110.8', opp: '–102.1', tag: '交易', tagIcon: 'trade', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'End Zone Elites', sub: 'ESPN · Keeper', score: '88.4', opp: '–71.9', tag: '一切就绪', tagIcon: 'check', tagKind: 'neutral' },
      ],
      lockedTitle: '本周预计优势',
      lockedSub: '涵盖全部 4 个联盟',
      lockedValue: '+14.6',
      lockedTag: 'AF Pro',
    },
  },
  stats: {
    items: [
      { value: '6', label: '覆盖运动' },
      { value: '13+', label: '联盟赛制' },
      { value: '3', label: '已上线平台' },
      { value: '实时', label: '比分与更新' },
    ],
    sports: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAA', 'Soccer'],
  },
  features: {
    kicker: '你将获得',
    rows: [
      {
        index: '01',
        title: ['你的所有联盟，', '一个面板。'],
        body:
          '导入 Sleeper、ESPN 和 Yahoo 的真实阵容与历史；MFL 与 Fantrax 即将推出。不用再在多个 App 间切换，在一个地方开始你的周日。',
      },
      {
        index: '02',
        title: ['清楚知道', '该处理什么。'],
        body:
          '同时查看所有联盟：未设置的阵容、今天的 waiver、等你处理的交易——每一项都标注了所属联盟和下一步该做什么。',
      },
      {
        index: '03',
        title: ['每位球员，', '每个联盟。'],
        body:
          '搜索任意球员，立刻看到你在所有球队中的持有情况，配以来自实时体育数据的真实数据、伤病和新闻——绝不把编造的数字伪装成事实。',
      },
    ],
  },
  howItWorks: {
    kicker: '使用方法',
    cards: [
      {
        icon: 'link',
        title: '1 · 连接你的联盟',
        body:
          '几秒钟连接 Sleeper、ESPN 或 Yahoo——MFL 与 Fantrax 即将推出。我们导入你的真实阵容、对阵和历史——无需手动设置。',
      },
      {
        icon: 'eye',
        title: '2 · 一览无余',
        body: '每个联盟都汇入同一个面板。你的球队、你的对阵、你的球员——终于并排呈现。',
      },
      {
        icon: 'cursor',
        title: '3 · 知道该做什么',
        body:
          'AllFantasy 读取你的所有联盟并指出需要关注的地方——未设置的阵容、waiver 目标、值得做的交易。你来决定，它为你指路。',
      },
    ],
  },
  commissioner: {
    kicker: '给联盟管理员',
    titleTop: '管理你的联盟。',
    titleBottom: '纵览其余所有。',
    bodyLead:
      '联盟管理员做得最多，得到的帮助却最少。获得管理联盟的工具——邀请、设置、对阵、排名、洞察——同时把你参加的每个',
    bodyEm: '其他',
    bodyTail: '联盟都汇入同一个指挥中心。',
    cta: '带上你的联盟',
    cards: [
      { icon: 'shuffle', title: '分配选秀', body: '有管理员退出？自动汇集他们的资产并进行实时选秀。' },
      { icon: 'shield', title: '公平性监控', body: '每笔交易都会悄悄进行公平性检查。可选的反摆烂机制让一切保持真实。' },
      { icon: 'dice', title: '加权抽签', body: 'NBA 式的王朝选秀顺位。杜绝摆烂又不失乐趣。' },
      { icon: 'broadcast', title: '联盟广播', body: '一次性向你的所有联盟发送公告、投票和活动。' },
    ],
  },
  pricing: {
    kicker: '简单定价',
    title: '所有联盟免费。升级获得优势。',
    body:
      '想建多少联盟就建多少，导入、运营都免费——选秀、交易、waiver、实时比分和排名全部包含，永久免费。选择 Pro 获得 Chimmy 和球员工具，Commissioner 获得联盟自动化与公平性工具，或 Supreme 两者兼得。',
    footnote: '付费方案可按月或按年计费。可随时在 设置 → 账单 中取消。',
    tiers: [
      {
        key: 'free', name: '免费', price: '$0', priceSuffix: '永久免费', priceYear: null,
        plan: null, featured: false, badge: null, cta: '免费开始',
        features: [
          { text: '无限创建和导入联盟' },
          { text: '选秀、交易、waiver 和实时比分' },
          { text: '所有联盟在一个面板' },
          { text: '管理员基础功能：设置、邀请和季后赛' },
        ],
      },
      {
        key: 'pro', name: 'AF Pro', price: planPrice('af_pro_monthly'), priceSuffix: '/月', priceYear: `或 ${planPrice('af_pro_yearly')}/年`,
        plan: 'pro', featured: false, badge: null, cta: '获取 AF Pro',
        features: [
          { text: '包含免费版全部' },
          { text: `Chimmy：每天 ${PRO_CHIMMY_DAILY} 次回答` },
          { text: '交易与 waiver 工具' },
          { text: '先发/替补与阵容建议' },
        ],
      },
      {
        key: 'commissioner', name: 'Commissioner', price: planPrice('af_commissioner_monthly'), priceSuffix: '/月', priceYear: `或 ${planPrice('af_commissioner_yearly')}/年`,
        plan: 'commissioner', featured: false, badge: null, cta: '获取 Commissioner',
        features: [
          { text: '包含免费版全部' },
          { text: '联盟自动化与自定义计分表' },
          { text: '公平性监控与联盟健康' },
          { text: '周报、实力排名与联盟故事' },
        ],
      },
      {
        key: 'supreme', name: 'AF Supreme', price: planPrice('af_supreme_monthly'), priceSuffix: '/月', priceYear: `或 ${planPrice('af_supreme_yearly')}/年`,
        plan: 'supreme', featured: true, badge: '最超值', cta: '获取 AF Supreme',
        features: [
          { text: '包含 AF Pro 和 Commissioner 全部' },
          { text: '王朝与新秀规划工具' },
          { text: '比分别购买两者更便宜' },
          { text: '为同时参赛的管理员打造' },
        ],
      },
    ],
  },
  finalCta: {
    title: '你的整个梦幻体育生活，尽在一处。',
    body: '抢先体验正陆续向经理和管理员开放。免费开始——无博彩、无 DFS，只有对你参加的每个联盟最清晰的视图。',
    primary: '免费开始',
    secondary: '创建联盟',
  },
  importFlow: {
    kicker: '把你的联盟连接到 AllFantasy',
    title: '几秒钟连接你的联盟。',
    body:
      '选择你的平台并输入 Sleeper 用户名或联盟 ID。创建免费账户，我们会构建一份只读副本，包含你真实的球队、对阵和计分——AllFantasy 分析你的联盟，但绝不更改外部平台上的任何内容。',
    submitFull: '连接我的联盟',
    submitMini: '连接',
    miniLabel: '连接你的联盟',
    importing: '正在带你连接联盟…',
    teaserCaption: '你的真实联盟会显示在这里',
    trustNote: '创建免费账户以连接你的 {label} 联盟——只读，永不需要密码。',
    nonSleeperNote: '创建免费账户以完成 {label} 的连接——永不需要密码。',
    accountNote: '创建免费账户，然后用 {label} 登录——我们为你列出联盟，无需联盟 ID。只读。',
    comingSoonNote: '{label} 尚未上线——即将推出。',
    platformSoon: '即将推出',
  },
  footer: {
    copyright: '© 2026 AllFantasy.ai',
    privacy: '隐私',
    terms: '条款',
    dataDeletion: '数据删除',
    signIn: '登录',
    geoNote:
      '华盛顿州（WA）不可用。付费联盟在 HI、ID、MT、NV 受限。AllFantasy 是 100% 梦幻体育——无博彩，无体育博彩。',
  },
}

// ── Filipino ─────────────────────────────────────────────────────────────────
const fil: NocturneCopy = {
  nav: {
    features: 'Mga Feature',
    howItWorks: 'Paano ito gumagana',
    forCommissioners: 'Para sa mga commissioner',
    signIn: 'Mag-sign in',
    getStarted: 'Magsimula nang libre',
    getStartedShort: 'Magsimula',
    ariaHome: 'AllFantasy home',
    ariaPrimaryNav: 'Pangunahin',
    ariaFooterNav: 'Footer',
  },
  hero: {
    badge: 'Fantasy sports lang · Walang sugal · Libre ang bawat league',
    titleTop: 'Bawat league na nilalaro mo.',
    titleAccent: 'Isang screen.',
    body:
      'Isama ang Sleeper, ESPN, Yahoo at iba pa sa iisang command center na nagpapakita kung ano ang kailangan mong asikasuhin, sino ang ilalaro, at saan pupunta — sa lahat ng iyong league nang sabay-sabay.',
    primary: 'Magsimula nang libre',
    secondary: 'Tingnan kung paano ito gumagana',
    finePrint: `Libreng gumawa, mag-import at magpatakbo ng league · Bayad na plano mula ${planPrice('af_pro_monthly')}/buwan · Kanselahin anumang oras`,
    mockup: {
      title: 'Ang iyong mga league',
      clock: 'Linggo 12 · Lin 11:41',
      rows: [
        { initial: 'S', color: '#1f2a4d', name: 'Dynasty Dragons', sub: 'Sleeper · Dynasty PPR', score: '96.2', opp: '–88.4', tag: 'Itakda ang flex', tagIcon: 'alert', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'Gridiron Gang', sub: 'ESPN · 0.5 PPR', score: '74.0', opp: '–91.6', tag: 'Waiver ngayon', tagIcon: 'bell', tagKind: 'accent' },
        { initial: 'Y', color: '#3a1d55', name: 'Waiver Warriors', sub: 'Yahoo · Standard', score: '110.8', opp: '–102.1', tag: 'Trade', tagIcon: 'trade', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'End Zone Elites', sub: 'ESPN · Keeper', score: '88.4', opp: '–71.9', tag: 'Handa na', tagIcon: 'check', tagKind: 'neutral' },
      ],
      lockedTitle: 'Inaasahang bentahe ngayong linggo',
      lockedSub: 'Sa lahat ng 4 na league',
      lockedValue: '+14.6',
      lockedTag: 'AF Pro',
    },
  },
  stats: {
    items: [
      { value: '6', label: 'Mga sport na saklaw' },
      { value: '13+', label: 'Mga format ng league' },
      { value: '3', label: 'Mga platform na live' },
      { value: 'Live', label: 'Score at updates' },
    ],
    sports: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAA', 'Soccer'],
  },
  features: {
    kicker: 'Ang makukuha mo',
    rows: [
      {
        index: '01',
        title: ['Lahat ng league mo,', 'isang board.'],
        body:
          'Sleeper, ESPN at Yahoo — na-import kasama ang iyong totoong roster at kasaysayan; malapit nang dumating ang MFL at Fantrax. Tigilan ang paglipat-lipat ng app; simulan ang iyong Linggo sa iisang lugar.',
      },
      {
        index: '02',
        title: ['Alamin kung ano ang', 'kailangan mong asikasuhin.'],
        body:
          'Sa lahat ng league nang sabay: hindi nakatakdang lineup, mga waiver ngayon, mga trade na naghihintay sa iyo — bawat isa may tatak kung aling league at kung ano ang susunod na gagawin.',
      },
      {
        index: '03',
        title: ['Bawat manlalaro,', 'bawat league.'],
        body:
          'Maghanap ng sinumang manlalaro at makita agad ang bawat team na kinaroroonan niya, may totoong stats, injury at balita mula sa live na datos ng sports — hindi kailanman gawa-gawang numero na ipinapakilalang totoo.',
      },
    ],
  },
  howItWorks: {
    kicker: 'Paano ito gumagana',
    cards: [
      {
        icon: 'link',
        title: '1 · Ikonekta ang iyong mga league',
        body:
          'Ikabit ang Sleeper, ESPN o Yahoo sa ilang segundo — malapit nang dumating ang MFL at Fantrax. Kinukuha namin ang iyong totoong roster, matchup at kasaysayan — walang manu-manong setup.',
      },
      {
        icon: 'eye',
        title: '2 · Makita ang lahat',
        body: 'Bawat league ay lalabas sa iisang board. Ang iyong mga team, matchup, at manlalaro — magkatabi, sa wakas.',
      },
      {
        icon: 'cursor',
        title: '3 · Alamin ang gagawin',
        body:
          'Binabasa ng AllFantasy ang lahat ng iyong league at itinuturo kung ano ang kailangang asikasuhin — ang hindi nakatakdang lineup, ang waiver target, ang trade na sulit. Ikaw ang magpapasya; itinuturo lang nito ang daan.',
      },
    ],
  },
  commissioner: {
    kicker: 'Para sa mga commissioner',
    titleTop: 'Patakbuhin ang iyong league.',
    titleBottom: 'Makita ang lahat ng iba mo.',
    bodyLead:
      'Ang mga commissioner ang pinakamaraming trabaho pero pinakakaunti ang tulong. Kunin ang mga tool para patakbuhin ang iyong league — imbitasyon, setting, matchup, standing, insight — habang ang bawat ',
    bodyEm: 'ibang',
    bodyTail: ' league na nilalaro mo ay sumasali sa iisang command center.',
    cta: 'Dalhin ang iyong league',
    cards: [
      { icon: 'shuffle', title: 'Dispersal draft', body: 'May umalis na manager? Tipunin ang kanilang assets at magpatakbo ng live draft — awtomatiko.' },
      { icon: 'shield', title: 'Integrity monitoring', body: 'Bawat trade ay tahimik na sinusuri para sa pagiging patas. Opsyonal na anti-tanking para manatiling totoo.' },
      { icon: 'dice', title: 'Weighted lottery', body: 'Draft order na tulad ng NBA para sa dynasty. Pinipigil ang tanking nang hindi nasisira ang saya.' },
      { icon: 'broadcast', title: 'League broadcast', body: 'Magpadala ng anunsyo, poll at event sa lahat ng iyong league nang sabay-sabay.' },
    ],
  },
  pricing: {
    kicker: 'Simpleng presyo',
    title: 'Libre ang bawat league. Mag-upgrade para sa bentahe.',
    body:
      'Gumawa, mag-import at magpatakbo ng kahit ilang league — kasama ang draft, trade, waiver, live na score at standing, libre habambuhay. Piliin ang Pro para kay Chimmy at sa mga tool ng manlalaro, Commissioner para sa league automation at integrity tools, o Supreme para sa pareho.',
    footnote: 'Ang bayad na plano ay sinisingil buwanan o taunan. Kanselahin anumang oras sa Settings → Billing.',
    tiers: [
      {
        key: 'free', name: 'Libre', price: '$0', priceSuffix: 'habambuhay', priceYear: null,
        plan: null, featured: false, badge: null, cta: 'Magsimula nang libre',
        features: [
          { text: 'Gumawa at mag-import ng walang limitasyong league' },
          { text: 'Draft, trade, waiver at live na score' },
          { text: 'Lahat ng league sa isang board' },
          { text: 'Mga pangunahing commissioner tool: settings, invite at playoffs' },
        ],
      },
      {
        key: 'pro', name: 'AF Pro', price: planPrice('af_pro_monthly'), priceSuffix: '/buwan', priceYear: `o ${planPrice('af_pro_yearly')}/taon`,
        plan: 'pro', featured: false, badge: null, cta: 'Kunin ang AF Pro',
        features: [
          { text: 'Lahat ng nasa Libre' },
          { text: `Chimmy: ${PRO_CHIMMY_DAILY} sagot bawat araw` },
          { text: 'Mga tool sa trade at waiver' },
          { text: 'Gabay sa start/sit at lineup' },
        ],
      },
      {
        key: 'commissioner', name: 'Commissioner', price: planPrice('af_commissioner_monthly'), priceSuffix: '/buwan', priceYear: `o ${planPrice('af_commissioner_yearly')}/taon`,
        plan: 'commissioner', featured: false, badge: null, cta: 'Kunin ang Commissioner',
        features: [
          { text: 'Lahat ng nasa Libre' },
          { text: 'League automation at custom na scoring table' },
          { text: 'Integrity monitoring at kalusugan ng league' },
          { text: 'Mga recap, power ranking at kuwento' },
        ],
      },
      {
        key: 'supreme', name: 'AF Supreme', price: planPrice('af_supreme_monthly'), priceSuffix: '/buwan', priceYear: `o ${planPrice('af_supreme_yearly')}/taon`,
        plan: 'supreme', featured: true, badge: 'Pinakasulit', cta: 'Kunin ang AF Supreme',
        features: [
          { text: 'Lahat ng nasa AF Pro at Commissioner' },
          { text: 'Mga dynasty at devy planning tool' },
          { text: 'Mas mura kaysa bilhin ang dalawa' },
          { text: 'Para sa mga commissioner na naglalaro rin' },
        ],
      },
    ],
  },
  finalCta: {
    title: 'Ang buong buhay-fantasy mo, sa iisang lugar.',
    body:
      'Papalabas na ngayon ang early access sa mga manager at commissioner. Libreng magsimula — walang sugal, walang DFS, tanging pinakamalinaw na tanawin ng bawat league na nilalaro mo.',
    primary: 'Magsimula nang libre',
    secondary: 'Magsimula ng league',
  },
  importFlow: {
    kicker: 'Ikonekta ang iyong league sa AllFantasy',
    title: 'Ikonekta ang iyong league sa ilang segundo.',
    body:
      'Piliin ang iyong platform at ilagay ang iyong Sleeper username o league ID. Gumawa ng libreng account at bubuo kami ng read-only na kopya ng iyong totoong mga team, matchup, at scoring — sinusuri ng AllFantasy ang iyong league ngunit hindi kailanman binabago ang anuman sa panlabas na platform.',
    submitFull: 'Ikonekta ang aking league',
    submitMini: 'Ikonekta',
    miniLabel: 'Ikonekta ang iyong league',
    importing: 'Dinadala ka namin para ikonekta ang iyong league…',
    teaserCaption: 'Lalabas dito ang iyong totoong mga league',
    trustNote: 'Gumawa ng libreng account para ikonekta ang iyong {label} league — read-only, walang password, kailanman.',
    nonSleeperNote: 'Gumawa ng libreng account para tapusin ang pagkonekta sa {label} — walang password, kailanman.',
    accountNote: 'Gumawa ng libreng account, pagkatapos mag-sign in gamit ang {label} — inililista namin ang iyong mga league, walang league ID na kailangan. Read-only.',
    comingSoonNote: 'Hindi pa available ang {label} — malapit na.',
    platformSoon: 'Malapit na',
  },
  footer: {
    copyright: '© 2026 AllFantasy.ai',
    privacy: 'Privacy',
    terms: 'Mga Tuntunin',
    dataDeletion: 'Pagbura ng data',
    signIn: 'Mag-sign in',
    geoNote:
      'Hindi available sa WA. Limitado ang bayad na league sa HI, ID, MT, NV. Ang AllFantasy ay 100% fantasy sports — walang sugal, walang sportsbook.',
  },
}

// ── Vietnamese ───────────────────────────────────────────────────────────────
const vi: NocturneCopy = {
  nav: {
    features: 'Tính năng',
    howItWorks: 'Cách hoạt động',
    forCommissioners: 'Dành cho commissioner',
    signIn: 'Đăng nhập',
    getStarted: 'Bắt đầu miễn phí',
    getStartedShort: 'Bắt đầu',
    ariaHome: 'Trang chủ AllFantasy',
    ariaPrimaryNav: 'Chính',
    ariaFooterNav: 'Chân trang',
  },
  hero: {
    badge: 'Chỉ fantasy sports · Không cá cược · Mọi giải đều miễn phí',
    titleTop: 'Mọi giải đấu bạn chơi.',
    titleAccent: 'Một màn hình.',
    body:
      'Đưa Sleeper, ESPN, Yahoo và hơn thế vào một trung tâm điều khiển duy nhất, cho bạn thấy điều gì cần chú ý, nên xếp ai ra sân và đi đâu tiếp theo — trên tất cả các giải cùng lúc.',
    primary: 'Bắt đầu miễn phí',
    secondary: 'Xem cách hoạt động',
    finePrint: `Tạo, nhập và vận hành giải miễn phí · Gói trả phí từ ${planPrice('af_pro_monthly')}/tháng · Hủy bất cứ lúc nào`,
    mockup: {
      title: 'Các giải của bạn',
      clock: 'Tuần 12 · CN 11:41',
      rows: [
        { initial: 'S', color: '#1f2a4d', name: 'Dynasty Dragons', sub: 'Sleeper · Dynasty PPR', score: '96.2', opp: '–88.4', tag: 'Đặt flex', tagIcon: 'alert', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'Gridiron Gang', sub: 'ESPN · 0.5 PPR', score: '74.0', opp: '–91.6', tag: 'Waiver hôm nay', tagIcon: 'bell', tagKind: 'accent' },
        { initial: 'Y', color: '#3a1d55', name: 'Waiver Warriors', sub: 'Yahoo · Standard', score: '110.8', opp: '–102.1', tag: 'Trao đổi', tagIcon: 'trade', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'End Zone Elites', sub: 'ESPN · Keeper', score: '88.4', opp: '–71.9', tag: 'Đã xong', tagIcon: 'check', tagKind: 'neutral' },
      ],
      lockedTitle: 'Lợi thế dự kiến tuần này',
      lockedSub: 'Trên cả 4 giải',
      lockedValue: '+14.6',
      lockedTag: 'AF Pro',
    },
  },
  stats: {
    items: [
      { value: '6', label: 'Môn thể thao' },
      { value: '13+', label: 'Định dạng giải' },
      { value: '3', label: 'Nền tảng đang hoạt động' },
      { value: 'Trực tiếp', label: 'Tỉ số & cập nhật' },
    ],
    sports: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAA', 'Soccer'],
  },
  features: {
    kicker: 'Bạn nhận được',
    rows: [
      {
        index: '01',
        title: ['Tất cả giải của bạn,', 'một bảng.'],
        body:
          'Sleeper, ESPN và Yahoo — nhập cùng đội hình và lịch sử thật của bạn; MFL và Fantrax sắp ra mắt. Đừng nhảy qua lại giữa các app; bắt đầu Chủ Nhật của bạn ở một nơi.',
      },
      {
        index: '02',
        title: ['Biết điều gì cần', 'bạn chú ý.'],
        body:
          'Trên mọi giải cùng lúc: đội hình chưa đặt, waiver hôm nay, trao đổi đang chờ bạn — mỗi mục được gắn nhãn thuộc giải nào và cần làm gì tiếp theo.',
      },
      {
        index: '03',
        title: ['Mọi cầu thủ,', 'mọi giải.'],
        body:
          'Tìm bất kỳ cầu thủ nào và thấy ngay mọi đội bạn đang sở hữu họ, kèm số liệu, chấn thương và tin tức thật từ dữ liệu thể thao trực tiếp — không bao giờ ngụy tạo con số rồi coi là sự thật.',
      },
    ],
  },
  howItWorks: {
    kicker: 'Cách hoạt động',
    cards: [
      {
        icon: 'link',
        title: '1 · Kết nối các giải của bạn',
        body:
          'Liên kết Sleeper, ESPN hoặc Yahoo trong vài giây — MFL và Fantrax sắp ra mắt. Chúng tôi nhập đội hình, cặp đấu và lịch sử thật của bạn — không cần thiết lập thủ công.',
      },
      {
        icon: 'eye',
        title: '2 · Thấy mọi thứ',
        body: 'Mỗi giải hiện trên cùng một bảng. Các đội, các cặp đấu, các cầu thủ của bạn — cuối cùng cũng cạnh nhau.',
      },
      {
        icon: 'cursor',
        title: '3 · Biết cần làm gì',
        body:
          'AllFantasy đọc tất cả giải của bạn và chỉ ra điều cần chú ý — đội hình chưa đặt, mục tiêu waiver, vụ trao đổi đáng làm. Bạn quyết định; nó chỉ đường.',
      },
    ],
  },
  commissioner: {
    kicker: 'Dành cho commissioner',
    titleTop: 'Điều hành giải của bạn.',
    titleBottom: 'Thấy tất cả giải khác.',
    bodyLead:
      'Commissioner làm nhiều nhất nhưng được hỗ trợ ít nhất. Có ngay công cụ để điều hành giải của bạn — lời mời, cài đặt, cặp đấu, bảng xếp hạng, phân tích — trong khi mọi ',
    bodyEm: 'giải khác',
    bodyTail: ' bạn chơi cùng gia nhập một trung tâm điều khiển.',
    cta: 'Đưa giải của bạn vào',
    cards: [
      { icon: 'shuffle', title: 'Dispersal draft', body: 'Có manager rời đi? Gom tài sản của họ và chạy draft trực tiếp — tự động.' },
      { icon: 'shield', title: 'Giám sát tính công bằng', body: 'Mỗi vụ trao đổi được kiểm tra công bằng một cách âm thầm. Chống buông (anti-tanking) tùy chọn giữ mọi thứ thật.' },
      { icon: 'dice', title: 'Xổ số có trọng số', body: 'Thứ tự draft kiểu NBA cho dynasty. Chặn buông mà không mất vui.' },
      { icon: 'broadcast', title: 'Phát sóng giải', body: 'Gửi thông báo, khảo sát và sự kiện đến tất cả giải của bạn cùng lúc.' },
    ],
  },
  pricing: {
    kicker: 'Giá đơn giản',
    title: 'Mọi giải đều miễn phí. Nâng cấp để có lợi thế.',
    body:
      'Tạo, nhập và vận hành bao nhiêu giải tùy thích — gồm draft, trao đổi, waiver, tỉ số trực tiếp và bảng xếp hạng, miễn phí trọn đời. Chọn Pro cho Chimmy và công cụ người chơi, Commissioner cho tự động hóa và công cụ công bằng của giải, hoặc Supreme cho cả hai.',
    footnote: 'Gói trả phí thanh toán theo tháng hoặc theo năm. Hủy bất cứ lúc nào trong Cài đặt → Thanh toán.',
    tiers: [
      {
        key: 'free', name: 'Miễn phí', price: '$0', priceSuffix: 'trọn đời', priceYear: null,
        plan: null, featured: false, badge: null, cta: 'Bắt đầu miễn phí',
        features: [
          { text: 'Tạo & nhập không giới hạn số giải' },
          { text: 'Draft, trao đổi, waiver & tỉ số trực tiếp' },
          { text: 'Tất cả giải trên một bảng' },
          { text: 'Công cụ commissioner cơ bản: cài đặt, lời mời & playoff' },
        ],
      },
      {
        key: 'pro', name: 'AF Pro', price: planPrice('af_pro_monthly'), priceSuffix: '/tháng', priceYear: `hoặc ${planPrice('af_pro_yearly')}/năm`,
        plan: 'pro', featured: false, badge: null, cta: 'Chọn AF Pro',
        features: [
          { text: 'Mọi thứ trong Miễn phí' },
          { text: `Chimmy: ${PRO_CHIMMY_DAILY} câu trả lời mỗi ngày` },
          { text: 'Công cụ trao đổi & waiver' },
          { text: 'Hướng dẫn start/sit & đội hình' },
        ],
      },
      {
        key: 'commissioner', name: 'Commissioner', price: planPrice('af_commissioner_monthly'), priceSuffix: '/tháng', priceYear: `hoặc ${planPrice('af_commissioner_yearly')}/năm`,
        plan: 'commissioner', featured: false, badge: null, cta: 'Chọn Commissioner',
        features: [
          { text: 'Mọi thứ trong Miễn phí' },
          { text: 'Tự động hóa giải & bảng tính điểm tùy chỉnh' },
          { text: 'Giám sát công bằng & sức khỏe giải' },
          { text: 'Tổng kết, bảng xếp hạng sức mạnh & câu chuyện' },
        ],
      },
      {
        key: 'supreme', name: 'AF Supreme', price: planPrice('af_supreme_monthly'), priceSuffix: '/tháng', priceYear: `hoặc ${planPrice('af_supreme_yearly')}/năm`,
        plan: 'supreme', featured: true, badge: 'Đáng giá nhất', cta: 'Chọn AF Supreme',
        features: [
          { text: 'Mọi thứ trong AF Pro & Commissioner' },
          { text: 'Công cụ lập kế hoạch dynasty & devy' },
          { text: 'Rẻ hơn mua riêng cả hai' },
          { text: 'Dành cho commissioner cũng tham gia chơi' },
        ],
      },
    ],
  },
  finalCta: {
    title: 'Toàn bộ đời sống fantasy của bạn, ở một nơi.',
    body:
      'Quyền truy cập sớm đang mở dần cho manager và commissioner. Miễn phí để bắt đầu — không cá cược, không DFS, chỉ là góc nhìn rõ ràng nhất về mọi giải bạn chơi.',
    primary: 'Bắt đầu miễn phí',
    secondary: 'Tạo một giải',
  },
  importFlow: {
    kicker: 'Kết nối giải của bạn với AllFantasy',
    title: 'Kết nối giải của bạn trong vài giây.',
    body:
      'Chọn nền tảng và nhập tên người dùng Sleeper hoặc ID giải. Tạo tài khoản miễn phí và chúng tôi dựng một bản sao chỉ đọc gồm các đội, cặp đấu và cách tính điểm thật của bạn — AllFantasy phân tích giải của bạn nhưng không bao giờ thay đổi bất cứ điều gì trên nền tảng bên ngoài.',
    submitFull: 'Kết nối giải của tôi',
    submitMini: 'Kết nối',
    miniLabel: 'Kết nối giải của bạn',
    importing: 'Đang đưa bạn đến kết nối giải…',
    teaserCaption: 'Các giải thật của bạn hiện ở đây',
    trustNote: 'Tạo tài khoản miễn phí để kết nối giải {label} của bạn — chỉ đọc, không bao giờ cần mật khẩu.',
    nonSleeperNote: 'Tạo tài khoản miễn phí để hoàn tất kết nối {label} — không bao giờ cần mật khẩu.',
    accountNote: 'Tạo tài khoản miễn phí, rồi đăng nhập bằng {label} — chúng tôi liệt kê giải của bạn, không cần ID giải. Chỉ đọc.',
    comingSoonNote: '{label} chưa khả dụng — sắp ra mắt.',
    platformSoon: 'Sắp ra mắt',
  },
  footer: {
    copyright: '© 2026 AllFantasy.ai',
    privacy: 'Quyền riêng tư',
    terms: 'Điều khoản',
    dataDeletion: 'Xóa dữ liệu',
    signIn: 'Đăng nhập',
    geoNote:
      'Không khả dụng ở WA. Giải trả phí bị hạn chế ở HI, ID, MT, NV. AllFantasy là 100% fantasy sports — không cá cược, không nhà cái.',
  },
}

const NOCTURNE_COPY_BY_LANG: Partial<Record<LanguageCode, NocturneCopy>> = {
  en: NOCTURNE_COPY,
  es,
  zh,
  fil,
  vi,
}

/**
 * Resolve the landing copy for a language code, falling back to English for
 * untranslated locales (fr/ar) or anything unrecognized.
 */
export function getNocturneCopy(lang: string | null | undefined): NocturneCopy {
  if (lang && Object.prototype.hasOwnProperty.call(NOCTURNE_COPY_BY_LANG, lang)) {
    return NOCTURNE_COPY_BY_LANG[lang as LanguageCode] ?? NOCTURNE_COPY
  }
  return NOCTURNE_COPY
}
