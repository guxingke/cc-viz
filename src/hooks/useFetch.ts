import { useEffect, useRef, useState } from 'react';

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const tick = useRef(0);

  const run = () => {
    const myTick = ++tick.current;
    setLoading(true);
    setError(null);
    fetcher()
      .then((d) => {
        if (tick.current === myTick) setData(d);
      })
      .catch((e: unknown) => {
        if (tick.current === myTick) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (tick.current === myTick) setLoading(false);
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);

  return { data, error, loading, refetch: run };
}
