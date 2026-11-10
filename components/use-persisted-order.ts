"use client";

import { useEffect, useRef, useState } from "react";
import { useDragOrder } from "./use-drag-order";

export function usePersistedOrder<T extends { id: string }>(items: T[], save: (ids: string[]) => Promise<void>, onError: (message: string) => void) {
  const [pending, setPending] = useState<string[] | null>(null);
  const saves = useRef(Promise.resolve());
  const sourceIds = items.map(item => item.id);
  const sourceKey = sourceIds.join("\u0000");
  const pendingKey = pending?.join("\u0000");

  useEffect(() => {
    if (pendingKey && pendingKey === sourceKey) queueMicrotask(() => setPending(null));
  }, [pendingKey, sourceKey]);

  const sorted = pending ? [...items].sort((a, b) => {
    const aIndex = pending.indexOf(a.id);
    const bIndex = pending.indexOf(b.id);
    return (aIndex < 0 ? -1 : aIndex) - (bIndex < 0 ? -1 : bIndex);
  }) : items;
  const drag = useDragOrder(sorted.map(item => item.id), ids => {
    setPending(ids);
    saves.current = saves.current.then(() => save(ids)).catch(issue => {
      setPending(null);
      onError(issue instanceof Error ? issue.message : "Could not save this order.");
    });
  });
  return { items: sorted, ...drag };
}
