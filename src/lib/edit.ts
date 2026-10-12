// ---------- editing and deleting ----------

import { addDays, atTime, clockTime, dayOf } from "./dates";
import { focus, set, state, type Draft } from "./state";
import type { Entry } from "./types";

export function openEdit(entry: Entry) {
  state.editing = {
    id: entry.id,
    running: !entry.endedAt,
    day: dayOf(new Date(entry.startedAt)),
    task: entry.task ?? "",
    projectId: entry.projectId,
    start: clockTime(entry.startedAt),
    end: entry.endedAt ? clockTime(entry.endedAt) : "",
  };
  focus.next = "edit-task";
  set({ confirming: null, error: null });
}

export function closeEdit(id: string) {
  focus.next = `edit-${id}`;
  set({ editing: null, error: null });
}

/** The draft's start and end. An end at or before the start is on the next day, as in the Cyclops web app. */
export function range(draft: { day: string; start: string; end: string }) {
  const start = draft.start ? atTime(draft.day, draft.start) : null;
  const end = draft.start && draft.end ? atTime(draft.end <= draft.start ? addDays(draft.day, 1) : draft.day, draft.end) : null;
  return { start, end };
}

/** What the draft changes, as PATCH /time-entries/:id takes it. */
export function changes(entry: Entry, draft: Draft) {
  const { start, end } = range(draft);
  if (!start || (!draft.running && !end)) throw new Error(draft.running ? "Enter a start time." : "Enter a start and an end time.");
  if (draft.running && start.getTime() > Date.now()) throw new Error("The start time can't be in the future while the timer runs.");
  if (!draft.running && draft.end === draft.start) throw new Error("The end time must differ from the start.");
  // The form shows minutes, so a time left alone matches its entry to the minute and isn't sent.
  const minute = (t: Date | string) => Math.floor(new Date(t).getTime() / 60_000);
  const body: Record<string, string> = {};
  // An empty task clears it, as in the Cyclops web app.
  if (draft.task.trim() !== (entry.task ?? "")) body.task = draft.task.trim();
  if (draft.projectId !== entry.projectId) body.projectId = draft.projectId;
  if (minute(start) !== minute(entry.startedAt)) body.startedAt = start.toISOString();
  if (end && minute(end) !== minute(entry.endedAt!)) body.endedAt = end.toISOString();
  return body;
}

export function openConfirm(id: string) {
  focus.next = `keep-${id}`;
  set({ confirming: id, editing: null, error: null });
}

export function closeConfirm(id: string) {
  focus.next = `delete-${id}`;
  set({ confirming: null, error: null });
}
