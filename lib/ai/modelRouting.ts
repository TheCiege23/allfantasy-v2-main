type AiModelRouteIntent =
  | 'grounded_answer'
  | 'complex_trade'
  | 'commissioner_report'

type AiModelRoute = {
  intent: AiModelRouteIntent
  model: string | null
  profile: 'cheap_fast' | 'strong'
  reason: string
}

type EnvLike = Record<string, string | undefined>

function firstEnv(env: EnvLike, keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return null
}

export function classifyRedraftQuestionForModel(question: string): AiModelRouteIntent {
  const text = question.toLowerCase()
  const asksForReport =
    /commissioner|weekly recap|league update|power ranking|newsletter|report/.test(text)
  if (asksForReport) return 'commissioner_report'

  const tradeTerms = /trade|deal|offer|counter|fair|fairness|risk|ros|rest of season/.test(text)
  const complexityTerms = /analy[sz]e|compare|multi|package|positional|playoff|schedule|scarcity|risk/.test(text)
  if (tradeTerms && complexityTerms) return 'complex_trade'

  return 'grounded_answer'
}

export function selectOpenAIModelForIntent(
  intent: AiModelRouteIntent,
  env: EnvLike = process.env,
): AiModelRoute {
  const cheapModel = firstEnv(env, [
    'OPENAI_MODEL_CHEAP',
    'OPENAI_MODEL_FAST',
    'OPENAI_MODEL_MINI',
    'AI_MODEL_CHEAP',
  ])
  const strongModel = firstEnv(env, [
    'OPENAI_MODEL_STRONG',
    'OPENAI_MODEL_REASONING',
    'OPENAI_MODEL_COMPLEX',
    'AI_MODEL_STRONG',
  ])
  const defaultModel = firstEnv(env, ['OPENAI_MODEL', 'AI_INTEGRATIONS_OPENAI_MODEL'])
  const useStrong = intent === 'complex_trade' || intent === 'commissioner_report'

  if (useStrong) {
    return {
      intent,
      model: strongModel ?? defaultModel ?? cheapModel,
      profile: 'strong',
      reason:
        intent === 'complex_trade'
          ? 'Complex trade analysis uses the stronger model profile.'
          : 'Commissioner reports use the stronger model profile.',
    }
  }

  return {
    intent,
    model: cheapModel ?? defaultModel ?? strongModel,
    profile: 'cheap_fast',
    reason: 'Normal grounded answers use the cheap/fast model profile.',
  }
}
