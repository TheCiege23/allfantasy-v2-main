import { useState, useCallback } from 'react';
import { toast } from 'sonner';

type AIResponse<T = any> = {
  data?: T;
  error?: string;
};

export function useAI<T = any>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callAI = useCallback(
    async (
      endpoint: string,
      body: Record<string, any>,
      options?: { successMessage?: string; errorMessage?: string }
    ): Promise<AIResponse<T>> => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
          // A plan, sign-in or daily-cap refusal carries a full sentence saying what to do next (wait until
          // tomorrow, or upgrade); show that rather than its bare error word.
          const refusalSentence =
            typeof data?.message === 'string' &&
            ['daily_limit_reached', 'feature_not_entitled', 'sign_in_required'].includes(data?.code)
              ? data.message
              : null;
          throw new Error(refusalSentence || data.error || options?.errorMessage || 'Chimmy request failed');
        }

        if (options?.successMessage) {
          toast.success(options.successMessage);
        }

        return { data: data as T };
      } catch (err: any) {
        const msg = err.message || 'Something went wrong';
        setError(msg);
        toast.error(msg);
        return { error: msg };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { callAI, loading, error };
}
