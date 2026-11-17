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
          throw new Error(data.error || options?.errorMessage || 'Chimmy request failed');
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
