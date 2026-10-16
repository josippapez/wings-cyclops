// The running timer on the clock button, with details when you point at it.

import { clockTime, duration, today } from "../lib/dates";
import { ch } from "../lib/messages";
import { state } from "../lib/state";
import type { Entry, Me, Project } from "../lib/types";
import { api } from "./api";

/** Projects by id, loaded when a timer's project isn't known yet. */
let projects: Map<string, Project> | null = null;
/** Timers' projects the last /projects didn't list, like an archived one, so they aren't asked for every 30 s. */
let missing = new Set<string>();

/** Cyclops files entries under days in the profile's timezone, which `today` uses, so load the profile first. */
export async function profile() {
  state.me ??= await api<Me>("/auth/me");
}

export async function refreshLabel() {
  try {
    if (!(await wings.secrets.has("token"))) {
      // Signed out: the next sign-in may be another account.
      state.me = null;
      projects = null;
      missing = new Set();
      return void (await wings.setSidebarLabel("tracker", null));
    }
    await profile();
    const timers = await api<Entry[]>("/time-entries/timers");
    if (timers.length === 0) return void (await wings.setSidebarLabel("tracker", null));
    const [entries] = await Promise.all([
      api<Entry[]>(`/time-entries?from=${today()}&to=${today()}`),
      projects && timers.every((t) => projects?.has(t.projectId) || missing.has(t.projectId))
        ? null
        : api<Project[]>("/projects").then((list) => {
            const byId = new Map(list.map((p) => [p.id, p]));
            projects = byId;
            missing = new Set(timers.map((t) => t.projectId).filter((id) => !byId.has(id)));
          }),
    ]);
    const first = timers.reduce((a, b) => (Date.parse(a.startedAt) <= Date.parse(b.startedAt) ? a : b));
    const since = (t: Entry) => (Date.now() - Date.parse(t.startedAt)) / 60_000;
    const logged = entries.filter((e) => e.endedAt).reduce((n, e) => n + (e.durationMinutes ?? 0), 0);
    const running = timers.reduce((n, t) => n + since(t), 0);
    const project = projects?.get(first.projectId);
    const minutes = Math.floor(since(first));
    await wings.setSidebarLabel("tracker", `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`, {
      rows: [
        ...(timers.length > 1 ? [{ label: "Running", value: `${timers.length} timers` }] : []),
        { label: "Task", value: first.task || "No description" },
        { label: "Project", value: project ? `${project.name} · ${project.clientName}` : "Unknown project" },
        { label: "Started", value: clockTime(first.startedAt) },
        { label: "Today", value: duration(logged + running) },
      ],
    });
  } catch (error) {
    console.error(error);
  }
}

/** A tool changed a timer or entry: update the button and tell the sidebar and popover. */
export function changed() {
  void refreshLabel();
  void ch.tell("timers-changed");
}
