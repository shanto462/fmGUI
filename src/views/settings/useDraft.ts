import { useState } from "react";

/**
 * A local copy of a saved value, for a field the user edits before it is saved.
 * It starts over when the saved value changes (for example after a save).
 */
export function useDraft<T>(value: T): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  // Reset during render instead of in an effect, so there is no extra render
  // with the old draft. See https://react.dev/learn/you-might-not-need-an-effect
  if (!Object.is(saved, value)) {
    setSaved(value);
    setDraft(value);
  }
  return [draft, setDraft];
}
