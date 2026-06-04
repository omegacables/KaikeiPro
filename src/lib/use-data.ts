"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { beginLoad, endLoad } from "./loading-bus";

type AsyncFn<T> = () => Promise<T>;

/**
 * Hook that fetches data from a server action.
 * Falls back to the provided fallback value if the fetch fails
 * (e.g., when DB is not yet set up).
 */
export function useData<T>(fetcher: AsyncFn<T>, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => {
    setLoading(true);
    beginLoad();
    fetcherRef.current()
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Data fetch failed, using fallback:", err.message);
        setError(err.message);
        setLoading(false);
      })
      .finally(() => endLoad());
  }, []);

  useEffect(() => {
    let cancelled = false;
    beginLoad();

    fetcherRef.current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Data fetch failed, using fallback:", err.message);
          setError(err.message);
          setLoading(false);
        }
      })
      .finally(() => endLoad());

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, setData, refetch };
}
