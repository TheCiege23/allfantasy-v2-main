/**
 * Client-safe mood UI config (no Prisma). Server mood persistence lives in lib/mood.ts.
 */

type MoodOption = {
  value: string;
  emoji: string;
  label: string;
  color: string;
  recommendations: {
    duration: string;
    meditationType: string;
    sound: string;
    breathingStyle: string;
    message: string;
  };
};

export const MOOD_OPTIONS: MoodOption[] = [
  {
    value: "calm",
    emoji: "🙂",
    label: "Calm",
    color: "from-sky-400 to-blue-500",
    recommendations: {
      duration: "10 min",
      meditationType: "focus",
      sound: "forest",
      breathingStyle: "calm",
      message: "You're in a clear headspace. A steady focus session can sharpen that calm.",
    },
  },
  {
    value: "anxious",
    emoji: "😟",
    label: "Anxious",
    color: "from-amber-400 to-orange-500",
    recommendations: {
      duration: "5 min",
      meditationType: "anxiety_reset",
      sound: "rain",
      breathingStyle: "4-7-8",
      message: "A 4-7-8 breathing reset can settle the moment without asking too much of you.",
    },
  },
  {
    value: "tired",
    emoji: "😴",
    label: "Tired",
    color: "from-indigo-400 to-violet-500",
    recommendations: {
      duration: "5 min",
      meditationType: "energy",
      sound: "birds",
      breathingStyle: "deep-reset",
      message: "A soft energy reset can help you feel more present without overstimulation.",
    },
  },
  {
    value: "energetic",
    emoji: "⚡",
    label: "Energetic",
    color: "from-emerald-400 to-teal-500",
    recommendations: {
      duration: "10 min",
      meditationType: "focus",
      sound: "forest",
      breathingStyle: "box",
      message: "Channel that momentum with a grounded rhythm so the energy stays useful.",
    },
  },
  {
    value: "overwhelmed",
    emoji: "🤯",
    label: "Overwhelmed",
    color: "from-rose-400 to-pink-500",
    recommendations: {
      duration: "3 min",
      meditationType: "stress_relief",
      sound: "rain",
      breathingStyle: "calm",
      message: "Start small. A short reset is enough to soften the edge of a heavy moment.",
    },
  },
];

export function getMoodRecommendation(mood: string) {
  return (
    MOOD_OPTIONS.find((option) => option.value === mood)?.recommendations ??
    MOOD_OPTIONS[0].recommendations
  );
}
