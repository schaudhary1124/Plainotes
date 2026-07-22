const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short, human relative time for timestamps shown in dense UI (sidebar rows, Home's
 * Continue list) - "just now", "12m ago", "3h ago", "Yesterday", "5d ago", then a plain date. */
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const delta = now - ms;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 2 * DAY) return "Yesterday";
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
