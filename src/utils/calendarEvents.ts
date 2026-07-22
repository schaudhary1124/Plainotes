/** A single event on the user's system calendar, once a native reader exists. */
export interface CalendarEvent {
  id: string;
  title: string;
  /** Epoch ms */
  start: number;
  end?: number;
  allDay?: boolean;
  /** Which of the user's calendars this came from, e.g. "Work" - once real. */
  calendarName?: string;
}

export type CalendarPermissionState = "unsupported" | "granted" | "denied" | "prompt";

/**
 * Reads the user's system calendar events for a given local day. Always resolves empty today -
 * there's no native plugin wired up yet (this app has no Tauri plugin beyond fs/opener). Real
 * access needs a platform-specific integration (macOS EventKit, Windows' Appointments API,
 * Linux typically Evolution Data Server) that can prompt for and hold onto OS permission, which
 * is its own follow-up project. The calendar UI (see Home.tsx) calls this unconditionally - no
 * on/off toggle - so it starts working the moment a real implementation lands here, with no UI
 * changes needed.
 */
export async function getEventsForDay(_date: Date): Promise<CalendarEvent[]> {
  return [];
}

/**
 * Whether this platform/build can read the system calendar at all, and if so whether the user
 * has granted access yet. Stubbed alongside getEventsForDay even though it's unused today,
 * because the UI will eventually need to tell "permission not granted" apart from "granted, but
 * nothing on the calendar today" - designing that in now is much cheaper than retrofitting it
 * once a real backend exists.
 */
export async function getCalendarPermissionState(): Promise<CalendarPermissionState> {
  return "unsupported";
}
