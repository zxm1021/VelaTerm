//! The forced hydration break.
//!
//! Shown by the reminder scheduler (see src/water/waterReminder.ts) for a fixed countdown, during which
//! the client is locked: the dialog cannot be dismissed, has no buttons, and takes keyboard focus so
//! keystrokes stop reaching the terminal behind it. The countdown is driven by a deadline timestamp
//! rather than by counting ticks, so a suspended machine cannot stretch the break.
//!
//! The lock is a UI-level lock, not a system one. It stops everything inside this client; the OS window
//! controls, the app menu (⌘Q, ⌘W), other applications, and force-quitting are all outside the reach of
//! a renderer process and remain available.

import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useTermStore } from "../store/termStore";
import { WATER_BREAK_SECONDS } from "../water/waterReminder";
import { Backdrop } from "./Backdrop";

/** Radius and stroke width of the countdown ring, in the SVG user units below. */
const RING_RADIUS = 46;
const RING_WIDTH = 4;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function WaterBreakModal() {
  const t = useT();
  const open = useTermStore((s) => s.waterBreakOpen);
  const close = useTermStore((s) => s.closeWaterBreak);
  const cardRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(WATER_BREAK_SECONDS);

  useEffect(() => {
    if (!open) return;
    // The deadline, not a decrementing counter: a counter that pauses while the machine is asleep would
    // silently extend the break past its 20 seconds.
    const deadline = Date.now() + WATER_BREAK_SECONDS * 1000;
    setRemaining(WATER_BREAK_SECONDS);

    const update = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) close();
    };
    update();
    const timer = setInterval(update, 200);

    // Take focus and keep it. Without this the terminal behind the dialog keeps receiving keystrokes and
    // the break would not actually stop the user from working.
    const pullFocus = () => cardRef.current?.focus();
    pullFocus();
    const onFocusIn = (e: FocusEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) pullFocus();
    };
    document.addEventListener("focusin", onFocusIn);

    return () => {
      clearInterval(timer);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, close]);

  if (!open) return null;

  const progress = remaining / WATER_BREAK_SECONDS;

  return (
    // No close handler: the backdrop is inert for the length of the break.
    <Backdrop onClose={() => {}} zIndex={10000}>
      <div
        ref={cardRef}
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        className="water-card"
        onKeyDown={(e) => {
          // Swallow Escape, Enter, and Tab so the dialog cannot be keyed away.
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="water-ring">
          <svg width="108" height="108" viewBox="0 0 108 108" aria-hidden="true">
            <circle
              cx="54"
              cy="54"
              r={RING_RADIUS}
              fill="none"
              stroke="var(--border)"
              strokeWidth={RING_WIDTH}
            />
            <circle
              cx="54"
              cy="54"
              r={RING_RADIUS}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={RING_WIDTH}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
              transform="rotate(-90 54 54)"
            />
          </svg>
          <span className="water-count">{remaining}</span>
        </div>

        <div className="water-title">{t("water.title")}</div>
        <div className="water-body">{t("water.body", WATER_BREAK_SECONDS)}</div>
        <div className="water-hint">{t("water.hint")}</div>
      </div>
    </Backdrop>
  );
}
