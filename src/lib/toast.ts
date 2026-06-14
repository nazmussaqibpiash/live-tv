"use client";

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (items: ToastItem[]) => void;

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l([...items]));
}

export function toast(message: string, kind: ToastKind = "info", ms = 2800): void {
  if (typeof window === "undefined") return;
  const id = ++seq;
  items = [...items, { id, message, kind }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, ms);
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn([...items]);
  return () => listeners.delete(fn);
}
