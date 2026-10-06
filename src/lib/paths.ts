/**
 * Shows a path inside the home folder with "~" instead of the home folder,
 * so the user name does not appear on screen (or in screenshots).
 * Paths outside the home folder come back unchanged.
 *
 *   tildePath("/Users/ada/.fm/sessions/x.json", "/Users/ada") === "~/.fm/sessions/x.json"
 */
export function tildePath(path: string, homeDir: string | null | undefined): string {
  if (!homeDir) return path;
  const home = homeDir.replace(/\/+$/, "");
  if (!home) return path;
  if (path === home) return "~";
  if (path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
}

/**
 * Replaces every home folder path inside a longer text (a command line, an
 * error message) with "~". Only whole path parts match, so "/Users/adam" is
 * not changed when the home folder is "/Users/ada".
 */
export function tildeText(text: string, homeDir: string | null | undefined): string {
  if (!homeDir) return text;
  const home = homeDir.replace(/\/+$/, "");
  if (!home) return text;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`${escaped}(?=$|[/\\s"'\`:;,)\\]}])`, "g"), "~");
}

/**
 * The reverse of tildePath for text the user typed in a path field:
 * "~" and "~/x" become absolute paths. Other text comes back unchanged.
 */
export function expandTilde(path: string, homeDir: string | null | undefined): string {
  if (!homeDir) return path;
  const home = homeDir.replace(/\/+$/, "");
  if (path === "~") return home;
  if (path.startsWith("~/")) return home + path.slice(1);
  return path;
}

/** "dir" + "name" with one slash between them. */
export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

/** The last part of a path: "/Users/ada/Projects/" → "Projects". */
export function baseName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}
