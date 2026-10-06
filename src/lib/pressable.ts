import type { KeyboardEvent } from "react";

/**
 * Props that make a non-button element (a list row that holds other buttons)
 * act like a button: it can be focused with Tab and runs `onPress` on click,
 * Enter and Space. Keys pressed on buttons inside the row are left alone.
 */
export function pressable(onPress: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPress();
      }
    },
  };
}
