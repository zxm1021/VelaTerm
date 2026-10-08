//! Hydration reminder: schedules the forced 20-second break dialogs.
//!
//! Schedule (local time, Monday to Friday): every hour from 10:00 through 12:00, then every hour from
//! 14:00 through 19:00 — nine reminders a day, with the 12:00–14:00 lunch window left alone.
//!
//! Two deliberate limitations:
//! - **Desktop only.** The dialog blocks the whole client for its countdown, which is the point at a
//!   desk and a trap on a phone. Browser and remote clients therefore never arm the timer; the
//!   `waterReminder` preference still syncs between shells so a desktop client sees the same setting.
//! - **Focus-gated, not focus-stealing.** A reminder that fires while the window is in the background
//!   cannot be seen and only wastes its countdown, so `fire` defers the dialog until the window is
//!   focused again. Nothing here raises or activates the window.
//!
//! The dialog is non-dismissable, so the timer never gives up on a due reminder: it keeps retrying
//! until the dialog actually appears, and only then advances to the next slot.

import { env } from "../platform";
import { useTermStore } from "../store/termStore";

/** Reminder slots, as hours on the 24-hour clock. */
export const WATER_REMINDER_HOURS = [10, 11, 12, 14, 15, 16, 17, 18, 19] as const;

/** Length of the forced break, in seconds. */
export const WATER_BREAK_SECONDS = 20;

/**
 * Retry cadence while the dialog is blocked. A due reminder is never skipped, so the only question is
 * how quickly a window that has just been focused shows the dialog: fast enough to feel immediate,
 * slow enough not to poll while the window sits in the background all afternoon.
 */
const RETRY_MS = 5_000;

/** setTimeout is 32-bit; beyond this the wait is re-armed instead of clamped, which would fire early. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Whether a local time falls on a weekday, matching the reminder schedule. */
function isWeekday(at: Date): boolean {
  const day = at.getDay();
  return day >= 1 && day <= 5;
}

/**
 * The next reminder strictly after `from`, or null when none can be computed.
 *
 * Each candidate is built through the Date constructor from local calendar fields rather than by adding
 * a fixed number of milliseconds, so a daylight-saving transition shifts the wall-clock time of the
 * reminder instead of silently moving it by an hour. Candidates that land in a skipped local hour (a
 * spring-forward transition) are discarded rather than reported at an hour that never occurs.
 */
export function nextWaterReminderAt(from: Date): Date | null {
  if (Number.isNaN(from.getTime())) return null;
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  // A week is enough to cross a weekend and reach the next weekday slot; a shorter scan would have to
  // reason about which day the search starts on.
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
    if (!isWeekday(date)) continue;
    for (const hour of WATER_REMINDER_HOURS) {
      const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
      // Reject hours normalized away by a DST transition, which would otherwise report the wrong time.
      if (at.getHours() !== hour || at.getTime() <= from.getTime()) continue;
      return at;
    }
  }
  return null;
}

/**
 * Whether this client runs the forced break at all. Phones and browser/remote clients are excluded: the
 * break blocks the entire client for its countdown, which is unacceptable on a device the user may be
 * holding away from their desk. Remote windows report `isElectron`/`isTauri` false and are excluded too.
 */
export function waterReminderSupported(): boolean {
  return env.isTauri || env.isElectron;
}

/**
 * Arm the reminder schedule. Returns a teardown function.
 *
 * The timer is only armed while the preference is on, so enabling it takes effect immediately and
 * disabling it cancels a pending reminder without a restart.
 */
export function startWaterReminder(): () => void {
  if (!waterReminderSupported()) return () => {};

  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  /** Whether the forced-break dialog is on screen, in which case nothing more should be scheduled. */
  const dialogOpen = () => useTermStore.getState().waterBreakOpen;

  const schedule = () => {
    clear();
    // Off by default, so this is the common path: stay idle rather than holding a timer that would wake
    // at the next slot only to discard itself. `onSettings` arms it the moment the preference is turned on.
    if (!useTermStore.getState().waterReminder) return;
    if (dialogOpen()) return;
    const next = nextWaterReminderAt(new Date());
    if (!next) return;
    const wait = next.getTime() - Date.now();
    // A wait past the 32-bit limit cannot be expressed; re-arm at the limit and recompute rather than
    // clamping, which would fire the reminder early.
    if (wait > MAX_TIMEOUT_MS) {
      timer = setTimeout(schedule, MAX_TIMEOUT_MS);
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (!useTermStore.getState().waterReminder) return; // Turned off while this timer was pending.
      tick();
    }, Math.max(wait, 0));
  };

  /**
   * Fire a due reminder, then re-arm. While the window is unfocused or another dialog owns the screen
   * the reminder stays due and this retries on `RETRY_MS` instead of waiting for the next slot, because
   * a deferred break must still happen once the user is actually looking at the window.
   */
  const tick = () => {
    // `openWaterBreak` refuses while the window is unfocused or another dialog is up; that refusal is
    // what keeps the reminder pending rather than letting it be mistaken for a shown dialog.
    if (useTermStore.getState().openWaterBreak()) {
      schedule();
      return;
    }
    clear();
    timer = setTimeout(tick, RETRY_MS);
  };

  /** Re-read the preference after any settings change and reconcile the timer with it. */
  const onSettings = () => {
    if (!useTermStore.getState().waterReminder) {
      clear();
      return;
    }
    if (timer === undefined && !dialogOpen()) schedule();
  };

  schedule();
  const unsubscribe = useTermStore.subscribe(onSettings);

  return () => {
    clear();
    unsubscribe();
  };
}
