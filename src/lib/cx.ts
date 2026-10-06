/** Joins class names and skips false, null and undefined: cx("a", on && "b"). */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
