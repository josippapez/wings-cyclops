// The page's state, kept outside React so the loading and actions below change it as before. render() tells
// React to draw it again.

import type { Entry, Me, Project } from "./types";

export interface Suggestion {
  task: string;
  projectIds: string[];
  lastUsedAt: number;
}
/** An entry being edited, with its times as HH:MM on `day` in the user's timezone. */
export interface Draft {
  id: string;
  running: boolean;
  day: string;
  task: string;
  projectId: string;
  start: string;
  end: string;
}
/**
 * `weeks` holds each week's entries by its Monday, once loaded. `day` is the day being looked at, or null to follow today.
 * `wholeWeek` lists every day of that day's week instead, like the Cyclops web app.
 * `adding` is the popover's form: a timer, or a manual entry today from `start` to `end` (HH:MM).
 */
export interface State {
  phase: "loading" | "connect" | "ready";
  me: Me | null;
  projects: Project[];
  timers: Entry[];
  weeks: Map<string, Entry[]>;
  day: string | null;
  wholeWeek: boolean;
  weekError: { week: string; message: string } | null;
  history: Map<string, Suggestion>;
  error: string | null;
  busy: Set<string>;
  task: string;
  projectId: string;
  editing: Draft | null;
  confirming: string | null;
  adding: { mode: "timer" | "manual"; start: string; end: string };
}

export const state: State = { phase: "loading", me: null, projects: [], timers: [], weeks: new Map(), day: null, wholeWeek: false, weekError: null, history: new Map(), error: null, busy: new Set(), task: "", projectId: "", editing: null, confirming: null, adding: { mode: "timer", start: "", end: "" } };

export function set(patch: Partial<State>) {
  Object.assign(state, patch);
  render();
}

let version = 0;
const listeners = new Set<() => void>();

/** Draws the page again from `state`. */
export function render() {
  version++;
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore: each render() is a new version. */
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const getVersion = () => version;

/** Where focus goes after the next render, when the element that has it is going away. */
export const focus: { next: string | null } = { next: null };
