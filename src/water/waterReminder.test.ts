//! Coverage for the hydration-break schedule.
//!
//! The schedule is the whole feature's contract: nine slots a day, weekdays only, and nothing across the
//! 12:00–14:00 lunch window. These tests pin the arithmetic rather than the timer, because a wrong slot
//! is silent — the dialog simply appears at the wrong hour, and nothing else in the app notices.

import { describe, expect, it } from "vitest";
import { WATER_REMINDER_HOURS, nextWaterReminderAt } from "./waterReminder";

/** Build a local Date from calendar fields, which is how the schedule itself works. */
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s);

/** Read a Date back as its local calendar fields, so assertions stay DST-agnostic. */
const fields = (d: Date) => ({
  date: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
  hour: d.getHours(),
  minute: d.getMinutes(),
});

describe("nextWaterReminderAt", () => {
  // 2026-10-08 is a Thursday, and 2026-10-10 a Saturday.
  it("advances to the next slot within the same morning", () => {
    expect(fields(nextWaterReminderAt(at(2026, 10, 8, 10, 30))!)).toEqual({
      date: "2026-10-8",
      hour: 11,
      minute: 0,
    });
  });

  it("returns the current hour's slot when it is still ahead", () => {
    expect(fields(nextWaterReminderAt(at(2026, 10, 8, 10, 0, 0))!)).toEqual({
      date: "2026-10-8",
      hour: 11,
      minute: 0,
    });
  });

  it("skips the lunch window between 12:00 and 14:00", () => {
    // 12:00 is the last morning slot, so the next one is 14:00 rather than 13:00.
    expect(fields(nextWaterReminderAt(at(2026, 10, 8, 11, 30))!)).toEqual({
      date: "2026-10-8",
      hour: 12,
      minute: 0,
    });
    expect(fields(nextWaterReminderAt(at(2026, 10, 8, 12, 0, 1))!)).toEqual({
      date: "2026-10-8",
      hour: 14,
      minute: 0,
    });
    expect(fields(nextWaterReminderAt(at(2026, 10, 8, 13, 45))!)).toEqual({
      date: "2026-10-8",
      hour: 14,
      minute: 0,
    });
  });

  it("ends the day at 19:00 and resumes the next weekday", () => {
    expect(fields(nextWaterReminderAt(at(2026, 10, 8, 18, 30))!)).toEqual({
      date: "2026-10-8",
      hour: 19,
      minute: 0,
    });
    // After the last slot the schedule rolls to the next morning, not to midnight.
    expect(fields(nextWaterReminderAt(at(2026, 10, 8, 19, 0, 1))!)).toEqual({
      date: "2026-10-9",
      hour: 10,
      minute: 0,
    });
  });

  it("never returns a slot equal to or before the reference time", () => {
    for (const hour of WATER_REMINDER_HOURS) {
      const now = at(2026, 10, 8, hour, 0, 0);
      expect(nextWaterReminderAt(now)!.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("skips the weekend and lands on Monday morning", () => {
    // Friday after the last slot.
    expect(fields(nextWaterReminderAt(at(2026, 10, 9, 20, 0))!)).toEqual({
      date: "2026-10-12",
      hour: 10,
      minute: 0,
    });
    // Saturday and Sunday at any hour.
    expect(fields(nextWaterReminderAt(at(2026, 10, 10, 11, 0))!)).toEqual({
      date: "2026-10-12",
      hour: 10,
      minute: 0,
    });
    expect(fields(nextWaterReminderAt(at(2026, 10, 11, 15, 0))!)).toEqual({
      date: "2026-10-12",
      hour: 10,
      minute: 0,
    });
  });

  it("fires every slot of a weekday in order", () => {
    // Walk the whole day: each returned slot must be strictly later than the previous one and land on
    // every hour in the list, which is what catches a dropped or duplicated slot.
    const seen: number[] = [];
    let cursor = at(2026, 10, 8, 9, 59, 59);
    for (let i = 0; i < WATER_REMINDER_HOURS.length; i++) {
      const next = nextWaterReminderAt(cursor)!;
      expect(next.getDate()).toBe(8);
      expect(next.getMinutes()).toBe(0);
      seen.push(next.getHours());
      cursor = next;
    }
    expect(seen).toEqual([...WATER_REMINDER_HOURS]);
  });

  it("always lands exactly on a configured slot", () => {
    // The invariant the Date-constructor construction buys: a result is always a whole slot at minute and
    // second zero, never an instant drifted by a fixed millisecond offset. Walked across a week so a
    // daylight-saving transition, in whatever zone the suite runs in, has to keep the wall-clock hour.
    let cursor = at(2026, 3, 6, 0, 0);
    for (let i = 0; i < 60; i++) {
      const next = nextWaterReminderAt(cursor)!;
      expect(next.getTime()).toBeGreaterThan(cursor.getTime());
      expect(WATER_REMINDER_HOURS).toContain(next.getHours());
      expect(next.getMinutes()).toBe(0);
      expect(next.getSeconds()).toBe(0);
      expect(next.getMilliseconds()).toBe(0);
      expect(next.getDay()).toBeGreaterThanOrEqual(1);
      expect(next.getDay()).toBeLessThanOrEqual(5);
      cursor = next;
    }
  });

  it("returns null for an invalid reference date", () => {
    expect(nextWaterReminderAt(new Date(NaN))).toBeNull();
  });
});
