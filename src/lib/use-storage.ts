import { useEffect, useState } from 'react';
import type { WxtStorageItem } from 'wxt/utils/storage';

/** Live value of a storage item; undefined until first load. */
export function useStorageValue<T>(item: WxtStorageItem<T, Record<string, unknown>>): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    void item.getValue().then((v) => alive && setValue(v));
    const unwatch = item.watch((v) => setValue(v));
    return () => {
      alive = false;
      unwatch();
    };
  }, [item]);
  return value;
}

/** Re-render on an interval, for relative times like "5 minutes ago". */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
