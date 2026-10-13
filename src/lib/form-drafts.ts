"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * In-memory drafts for form fields that should survive client navigations
 * (e.g. generate idea + uploaded file when visiting Calendar and coming back).
 * Files stay as File objects — sessionStorage cannot hold them.
 */
const drafts = new Map<string, unknown>();

export function peekDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}

export function writeDraft<T>(key: string, value: T): void {
  drafts.set(key, value);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

export function useFormDraft<T extends Record<string, unknown>>(key: string, initial: T) {
  const initialRef = useRef(initial);
  const [state, setState] = useState<T>(() => {
    const saved = peekDraft<Partial<T>>(key);
    return saved ? { ...initialRef.current, ...saved } : { ...initialRef.current };
  });

  useEffect(() => {
    const saved = peekDraft<Partial<T>>(key);
    setState(saved ? { ...initialRef.current, ...saved } : { ...initialRef.current });
  }, [key]);

  const update = useCallback(
    (patch: Partial<T>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        writeDraft(key, next);
        return next;
      });
    },
    [key],
  );

  const reset = useCallback(() => {
    clearDraft(key);
    setState({ ...initialRef.current });
  }, [key]);

  return [state, update, reset] as const;
}
