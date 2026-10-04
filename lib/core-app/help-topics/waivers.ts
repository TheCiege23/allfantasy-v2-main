import type { HelpTopic } from '../helpTopics'

/** The Waivers screens' terms (league Waivers, Worth adding, the cross-league board). See ../helpTopics.ts. */
export const WAIVERS_TOPICS = {
  faab: {
    en: {
      title: 'FAAB',
      body: 'Free Agent Acquisition Budget — the money you bid on waiver claims. The highest bid wins the player and that amount comes out of your budget; a claim that loses costs nothing. The rank compares the budget you have left with the rest of the league.',
    },
    es: {
      title: 'FAAB',
      body: 'Presupuesto para agentes libres: el dinero con el que pujas en los reclamos. Gana la puja más alta y ese monto sale de tu presupuesto; un reclamo que pierde no cuesta nada. El puesto compara tu presupuesto restante con el del resto de la liga.',
    },
  },
  waiverPriority: {
    en: {
      title: 'Waiver priority',
      body: 'Your place in the waiver order — #1 claims first. When two teams claim the same player, the better priority wins. In rolling waivers a successful claim sends you to the back; in reverse standings the order resets each week by record.',
    },
    es: {
      title: 'Prioridad de reclamos',
      body: 'Tu lugar en el orden de reclamos: el #1 reclama primero. Si dos equipos piden al mismo jugador, gana la mejor prioridad. Con prioridad rotativa, un reclamo exitoso te manda al final; con clasificación inversa, el orden se rehace cada semana según el récord.',
    },
  },
  claimsQueued: {
    en: {
      title: 'Claims queued',
      body: 'Claims you have placed in this league that have not processed yet. Only leagues run on AllFantasy can show this — other platforms keep your pending claims private, so we cannot see them.',
    },
    es: {
      title: 'Reclamos en cola',
      body: 'Reclamos que hiciste en esta liga y que aún no se procesan. Solo las ligas que corren en AllFantasy pueden mostrarlo: las demás plataformas mantienen tus reclamos pendientes en privado.',
    },
  },
  waiverType: {
    en: {
      title: 'Waiver type',
      body: 'How claims are decided. FAAB: blind bidding with a budget, highest bid wins. Rolling or standard priority: the best priority wins. Reverse standings: the worst record claims first. First come, first served: no waiting period.',
    },
    es: {
      title: 'Tipo de reclamos',
      body: 'Cómo se deciden los reclamos. FAAB: pujas a ciegas con un presupuesto; gana la más alta. Prioridad rotativa o estándar: gana la mejor prioridad. Clasificación inversa: reclama primero el peor récord. Por orden de llegada: sin periodo de espera.',
    },
  },
  waiverRun: {
    en: {
      title: 'When waivers run',
      body: 'When this league processes claims — a claim placed before then is decided in that run. Shown in the time zone the league runs on, with your own time beside it. For a Sleeper league it is read from when its claims actually processed, or from Sleeper’s own settings.',
    },
    es: {
      title: 'Cuándo se procesan',
      body: 'Cuándo esta liga procesa los reclamos: lo que pidas antes se decide en esa ejecución. Se muestra en la zona horaria de la liga, con tu hora al lado. En una liga de Sleeper se toma de cuándo se procesaron de verdad sus reclamos, o de la configuración de Sleeper.',
    },
  },
  tiebreak: {
    en: {
      title: 'Tiebreak',
      body: 'What decides between two claims that are otherwise equal — in FAAB, the same player at the same bid.',
    },
    es: {
      title: 'Desempate',
      body: 'Lo que decide entre dos reclamos iguales en todo lo demás; en FAAB, el mismo jugador con la misma puja.',
    },
  },
  claimLimits: {
    en: {
      title: 'Claim limits',
      body: 'Any cap the league puts on how many claims or adds you can make in a period.',
    },
    es: {
      title: 'Límites de reclamos',
      body: 'Cualquier tope que la liga ponga a cuántos reclamos o altas puedes hacer en un periodo.',
    },
  },
  worthAdding: {
    en: {
      title: 'Worth adding',
      body: 'Free agents ranked by what each would add to your best starting lineup, under this league’s scoring: +N is the projected points he gains over the starter named in “over …”. Late in the week it switches to next week’s projections once they are out. AF is AllFantasy’s own projection; the ranking uses the provider’s.',
    },
    es: {
      title: 'Vale la pena agregar',
      body: 'Agentes libres ordenados por lo que cada uno sumaría a tu mejor alineación titular, con la puntuación de esta liga: +N son los puntos proyectados que gana sobre el titular que aparece en “over …”. Al final de la semana pasa a las proyecciones de la siguiente cuando ya salieron. AF es la proyección propia de AllFantasy; el orden usa la del proveedor.',
    },
  },
  lineupGain: {
    en: {
      title: 'Lineup gain',
      body: 'How many projected points the best free agent on that league’s wire would add to your best starting lineup, after replacing the starter he beats — scored under that league’s own rules. Cards are ranked by it. Outside the NFL it is per game, from a season rate.',
    },
    es: {
      title: 'Ganancia en la alineación',
      body: 'Cuántos puntos proyectados sumaría el mejor agente libre de esa liga a tu mejor alineación titular, tras reemplazar al titular que supera, con las reglas de esa liga. Las tarjetas se ordenan por esto. Fuera de la NFL es por partido, a partir de un ritmo de temporada.',
    },
  },
  afProjection: {
    en: {
      title: 'AF projection',
      body: 'AllFantasy’s own projection engine, scored with this league’s settings and shown beside the provider’s projection as a second opinion. The ranking uses the provider’s figure.',
    },
    es: {
      title: 'Proyección AF',
      body: 'El motor de proyecciones propio de AllFantasy, con la puntuación de esta liga, junto a la proyección del proveedor como segunda opinión. El orden usa la cifra del proveedor.',
    },
  },
  marketRates: {
    en: {
      title: 'Rostered and Started',
      body: 'Rostered: the share of leagues on AllFantasy that have him on a roster. Started: of those leagues, the share starting him this week. Shown only once at least 8 leagues are counted — a dash means too few to say.',
    },
    es: {
      title: 'En plantilla y titular',
      body: 'En plantilla: la parte de las ligas en AllFantasy que lo tienen en un equipo. Titular: de esas ligas, la parte que lo alinea esta semana. Solo se muestra con al menos 8 ligas contadas; un guion significa que son muy pocas.',
    },
  },
} satisfies Record<string, HelpTopic>
