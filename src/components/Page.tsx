import { useLayoutEffect, useSyncExternalStore, type ComponentType } from "react";

import { load, refresh, shownWeek } from "../lib/data";
import { elapsed, weekStart } from "../lib/dates";
import { focus, getVersion, render, state, subscribe } from "../lib/state";

/** Draws `view` again on each render(). */
export function Page({ view: View }: { view: ComponentType }) {
  useSyncExternalStore(subscribe, getVersion);
  // After each render, focus moves where an action asked it to, as its element went away.
  useLayoutEffect(() => {
    const focused = focus.next;
    focus.next = null;
    if (focused) document.getElementById(focused)?.focus();
  });
  // A new element each time, so the page under it draws again rather than React keeping the last one.
  return <View />;
}

/** Loads Cyclops, keeps the clocks ticking and the data fresh, and follows the main script's broadcasts. */
export function startPage() {
  // Running clocks tick every second without a reload; the data refreshes every minute.
  setInterval(() => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-started]")) el.textContent = elapsed(el.dataset.started ?? "");
  }, 1000);
  // Not while an entry is being edited: a render moves the caret of a time field back to its hours.
  setInterval(() => {
    if (state.phase === "ready" && state.busy.size === 0 && !state.editing) void refresh().then(render, () => {});
  }, 60_000);

  // Claude started or stopped a timer, or changed or deleted an entry, through the plugin's tools. The entry may be
  // in any week, so earlier weeks load again when you next go to them.
  wings.onBroadcast((message) => {
    if ((message as { type?: unknown } | null)?.type !== "timers-changed" || state.phase !== "ready") return;
    for (const monday of state.weeks.keys()) if (monday !== weekStart() && monday !== shownWeek()) state.weeks.delete(monday);
    void refresh(true).then(render, () => {});
  });

  void load();
}
