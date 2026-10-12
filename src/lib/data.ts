// ---------- loading ----------

import { api, SignedOut } from "./api";
import { addDays, mondayOf, today, weekStart } from "./dates";
import { render, set, state, type Suggestion } from "./state";
import type { Entry, Me, Project } from "./types";

export async function load() {
  try {
    if (!(await wings.secrets.has("token"))) return set({ phase: "connect" });
    const [me, projects] = await Promise.all([api<Me>("/auth/me"), api<Project[]>("/projects")]);
    state.me = me;
    state.projects = projects;
    await Promise.all([refresh(), loadHistory()]);
    set({ phase: "ready" });
  } catch (error) {
    if (error instanceof SignedOut) return set({ phase: "connect", error: "Cyclops didn't accept the saved token. Connect again." });
    set({ phase: state.phase === "loading" ? "connect" : state.phase, error: String((error as Error).message ?? error) });
  }
}

// Task suggestions come from the last 8 weeks, like the Cyclops web app. That one keeps them in localStorage,
// which a sandboxed page can't use, so they load once per open instead.
export async function loadHistory() {
  remember(await api<Entry[]>(`/time-entries?from=${weekStart(7)}`));
}

/** Adds entries' tasks to the suggestions: one per task ignoring case, with every project it was logged on. */
function remember(entries: Entry[]) {
  for (const entry of entries) {
    const task = entry.task?.trim();
    const lastUsedAt = Date.parse(entry.startedAt);
    if (!task || Number.isNaN(lastUsedAt)) continue;
    const key = task.toLowerCase();
    const old = state.history.get(key);
    const projectIds = old ? [...new Set([...old.projectIds, entry.projectId])] : [entry.projectId];
    const newer = !old || lastUsedAt > old.lastUsedAt;
    state.history.set(key, { task: newer ? task : old!.task, projectIds, lastUsedAt: newer ? lastUsedAt : old!.lastUsedAt });
  }
}

/** Up to 8 tasks containing `query`, the selected project's first, then the most recent. */
export function suggest(query: string, projectId: string) {
  const q = query.trim().toLowerCase();
  const has = (s: Suggestion) => s.projectIds.includes(projectId);
  return [...state.history.values()]
    .filter((s) => !q || s.task.toLowerCase().includes(q))
    .sort((a, b) => (projectId && has(a) !== has(b) ? (has(a) ? -1 : 1) : b.lastUsedAt - a.lastUsedAt))
    .slice(0, 8);
}

export const selectedDay = () => state.day ?? today();
export const shownWeek = () => mondayOf(selectedDay());
const weekPath = (monday: string) => `/time-entries?from=${monday}&to=${addDays(monday, 6)}`;

/** Reloads the timers and this week, and with `shown` also the earlier week on screen. */
export async function refresh(shown = false) {
  const current = weekStart();
  // A week that isn't loaded yet is loadWeek's to fetch.
  const other = shown && shownWeek() !== current && state.weeks.has(shownWeek()) ? shownWeek() : null;
  const [timers, week, older] = await Promise.all([api<Entry[]>("/time-entries/timers"), api<Entry[]>(weekPath(current)), other ? api<Entry[]>(weekPath(other)) : null]);
  state.timers = timers;
  state.weeks.set(current, week);
  if (other) state.weeks.set(other, older!);
  remember([...timers, ...week, ...(older ?? [])]);
  if (!state.projectId) state.projectId = timers[0]?.projectId ?? week[0]?.projectId ?? state.projects[0]?.id ?? "";
}

/** The Monday being fetched. One week loads at a time, so clicking quickly through weeks only asks for the one you stop on. */
let loadingWeek: string | null = null;

/** Fetches the week on screen unless it's loaded, or failed until you try again. */
async function loadWeek() {
  const monday = shownWeek();
  if (loadingWeek || state.weeks.has(monday) || state.weekError?.week === monday) return;
  loadingWeek = monday;
  try {
    const entries = await api<Entry[]>(weekPath(monday));
    state.weeks.set(monday, entries);
    remember(entries);
  } catch (error) {
    if (error instanceof SignedOut) return set({ phase: "connect", error: "Cyclops didn't accept the saved token. Connect again." });
    state.weekError = { week: monday, message: String((error as Error).message ?? error) };
  } finally {
    loadingWeek = null;
  }
  render();
  // You may have moved to another week while this one loaded.
  void loadWeek();
}

/** Shows a day, or today for null, and loads its week. */
export function show(day: string | null) {
  state.day = day && day < today() ? day : null;
  state.weekError = null;
  // An entry being edited or deleted goes off screen. A running timer's stays.
  if (state.editing && !state.editing.running) state.editing = null;
  if (state.confirming && !state.timers.some((t) => t.id === state.confirming)) state.confirming = null;
  render();
  void loadWeek();
}

/** Runs an action with its button showing progress, then reloads. */
export async function act(key: string, task: () => Promise<unknown>) {
  state.busy.add(key);
  set({ error: null });
  try {
    await task();
    // The main script keeps the title bar button current.
    void wings.broadcast({ type: "timers-changed" });
    await refresh(true);
  } catch (error) {
    if (error instanceof SignedOut) return set({ phase: "connect", error: "Cyclops didn't accept the saved token. Connect again." });
    state.error = String((error as Error).message ?? error);
  } finally {
    state.busy.delete(key);
    render();
  }
}

/** The start form's project and task, as Cyclops takes them. It refuses empty fields, so a blank task is left out rather than sent as "". */
export function newEntry() {
  const task = state.task.trim();
  return task ? { projectId: state.projectId, task } : { projectId: state.projectId };
}

export function startTimer() {
  const body = newEntry();
  void act("start", async () => {
    await api("/time-entries/timer", { method: "POST", body });
    state.task = "";
  });
}
