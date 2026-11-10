"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { moveBeforeOrAfter, moveOne } from "../lib/priority-order";

type DragState = { source: string; target: string | null } | null;

export function useDragOrder(ids: string[], onReorder: (ids: string[]) => void) {
  const sourceRef = useRef<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);

  function targetAt(x: number, y: number) {
    const available = new Set(ids);
    const underPointer = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-sort-id]");
    if (underPointer?.dataset.sortId && available.has(underPointer.dataset.sortId)) return underPointer.dataset.sortId;
    const rows = [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].filter(row => row.dataset.sortId && available.has(row.dataset.sortId));
    if (!rows.length) return null;
    const bounds = rows.map(row => row.getBoundingClientRect());
    if (y < Math.min(...bounds.map(rect => rect.top)) - 30 || y > Math.max(...bounds.map(rect => rect.bottom)) + 30) return null;
    if (x < Math.min(...bounds.map(rect => rect.left)) - 50 || x > Math.max(...bounds.map(rect => rect.right)) + 50) return null;
    const nearest = rows.reduce((best, row) => {
      const rect = row.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - y);
      return distance < best.distance ? { id: row.dataset.sortId!, distance } : best;
    }, { id: rows[0].dataset.sortId!, distance: Infinity });
    return nearest.id;
  }

  function stop(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const source = sourceRef.current;
    if (!source) return;
    const target = cancelled ? null : targetAt(event.clientX, event.clientY);
    sourceRef.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (target && target !== source) {
      const moved = moveBeforeOrAfter(ids, source, target);
      if (moved !== ids) onReorder(moved);
    }
  }

  function bind(id: string) {
    return {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (event.button !== 0) return;
        event.preventDefault();
        sourceRef.current = id;
        setDrag({ source: id, target: null });
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        if (sourceRef.current !== id) return;
        event.preventDefault();
        if (event.clientY < 70) window.scrollBy(0, -14);
        else if (event.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
        const target = targetAt(event.clientX, event.clientY);
        setDrag(current => current?.source === id && current.target !== target ? { source: id, target } : current);
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) { stop(event); },
      onPointerCancel(event: PointerEvent<HTMLButtonElement>) { stop(event, true); },
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const moved = moveOne(ids, id, event.key === "ArrowUp" ? -1 : 1);
        if (moved !== ids) onReorder(moved);
      },
    };
  }

  return { bind, draggedId: drag?.source || null, targetId: drag?.target || null };
}
