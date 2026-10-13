// Keeps the running timer on the clock button, with details when you point at it, and runs the tools Claude
// calls. The sidebar and this script tell each other about changes with wings.broadcast, so a timer started
// in one shows in the other at once. Changes made elsewhere show on the next 30 s poll while Wings is in front, at once when it comes back, or on Refresh.

import { pollWhileFocused } from "wings-plugin-sdk/poll";

import { clockTime, today } from "./lib/dates";
import { state } from "./lib/state";
import type { Entry, Me, Project } from "./lib/types";

const API = "https://cyclops-api.prototyp.digital/api";

async function api<T = unknown>(path: string, { method = "GET", body }: { method?: string; body?: object } = {}, retried = false): Promise<T> {
  if (!(await wings.secrets.has("token"))) throw new Error("Cyclops isn't connected. Open the Cyclops sidebar in Wings and connect it.");
  const res = await wings.fetch(API + path, {
    method,
    bearer: "token",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: { message?: unknown } | null = null;
  try {
    data = res.body ? JSON.parse(res.body) : null;
  } catch {}
  const message = typeof data?.message === "string" ? data.message : Array.isArray(data?.message) ? data.message.join(", ") : "";
  // Cyclops says a 409 ending in "try again" is a lost race worth one plain retry.
  if (res.status === 409 && /try again$/i.test(message) && !retried) return api(path, { method, body }, true);
  if (res.status === 401) throw new Error("Cyclops didn't accept the saved token. Connect again in the Cyclops sidebar.");
  if (res.status >= 400) throw new Error(message || `Cyclops answered ${res.status}`);
  return data as T;
}

/** Projects by id, loaded when a timer's project isn't known yet. */
let projects: Map<string, Project> | null = null;
/** Timers' projects the last /projects didn't list, like an archived one, so they aren't asked for every 30 s. */
let missing = new Set<string>();
/** Cyclops files entries under days in the profile's timezone, which `today` uses, so load the profile first. */
async function profile() {
  state.me ??= await api<Me>("/auth/me");
}
function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

async function refresh() {
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

// The sidebar started, stopped or resumed a timer, or connected or signed out.
wings.onBroadcast((message) => {
  if ((message as { type?: unknown } | null)?.type === "timers-changed") void refresh();
});

void refresh();
// Two requests a minute stay far below Cyclops's limit of 100 per token, and none go out while Wings is in the
// background: the label is checked again the moment you come back.
pollWhileFocused(() => void refresh(), 30_000);

// ---------- tools for Claude ----------

const projectInfo = (p: Project) => ({ id: p.id, name: p.name, client: p.clientName });

async function timers() {
  const [running, projects] = await Promise.all([api<Entry[]>("/time-entries/timers"), api<Project[]>("/projects")]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  return running.map((t) => ({
    id: t.id,
    project: byId.get(t.projectId)?.name ?? t.projectId,
    client: byId.get(t.projectId)?.clientName ?? null,
    task: t.task || null,
    startedAt: t.startedAt,
  }));
}

wings.onTool("list_projects", async () => (await api<Project[]>("/projects")).map(projectInfo));

wings.onTool("running_timers", async () => {
  const running = await timers();
  return running.length ? running : "No timer is running.";
});

wings.onTool("start_timer", async ({ projectId, task }) => {
  if (typeof projectId !== "string") throw new Error("projectId is required. Get one from list_projects.");
  const text = typeof task === "string" ? task.trim() : "";
  const timer = await api<Entry | null>("/time-entries/timer", { method: "POST", body: text ? { projectId, task: text } : { projectId } });
  void refresh();
  void wings.broadcast({ type: "timers-changed" });
  return { started: true, timerId: timer?.id ?? null, projectId, task: text || null };
});

wings.onTool("stop_timer", async ({ timerId }) => {
  let id = typeof timerId === "string" ? timerId : null;
  if (!id) {
    const running = await timers();
    if (running.length === 0) return "No timer is running.";
    if (running.length > 1) throw new Error(`${running.length} timers are running. Pass timerId, from running_timers.`);
    id = running[0].id;
  }
  await api(`/time-entries/${encodeURIComponent(id)}/stop`, { method: "POST" });
  void refresh();
  void wings.broadcast({ type: "timers-changed" });
  return { stopped: true, timerId: id };
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Cyclops reads a time without an offset in its server's own timezone, so one is required.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

function uuid(value: unknown, name: string, source: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${name} must be an id from ${source}.`);
  return value;
}

const entryInfo = (e: Entry, byId: Map<string, Project>) => ({
  id: e.id,
  date: e.entryDate,
  task: e.task || null,
  project: byId.get(e.projectId)?.name ?? e.projectId,
  client: byId.get(e.projectId)?.clientName ?? null,
  projectId: e.projectId,
  startedAt: e.startedAt,
  endedAt: e.endedAt,
  minutes: e.durationMinutes,
});

wings.onTool("list_entries", async ({ from, to }) => {
  for (const [name, value] of Object.entries({ from, to })) {
    if (value !== undefined && (typeof value !== "string" || !DAY.test(value))) throw new Error(`${name} must be a date like 2026-10-08.`);
  }
  await profile();
  // Checked above: each is a YYYY-MM-DD string or left out.
  const first = (from ?? to ?? today()) as string;
  const last = (to ?? (first > today() ? first : today())) as string;
  if (first > last) throw new Error("from must be on or before to.");
  const [entries, list] = await Promise.all([api<Entry[]>(`/time-entries?from=${first}&to=${last}`), api<Project[]>("/projects")]);
  const byId = new Map(list.map((p) => [p.id, p]));
  return entries.length ? entries.map((e) => entryInfo(e, byId)) : `No entries from ${first} to ${last}.`;
});

wings.onTool("update_entry", async (input) => {
  const allowed = ["entryId", "task", "projectId", "startedAt", "endedAt"];
  // A misspelt field would otherwise be dropped without a word, and the call would look like it worked.
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`update_entry doesn't take ${unknown.join(", ")}. It takes ${allowed.join(", ")}.`);
  const entryId = uuid(input.entryId, "entryId", "list_entries or running_timers");
  const body: Record<string, string> = {};
  if (input.task !== undefined) {
    if (typeof input.task !== "string") throw new Error("task must be a string.");
    // An empty task clears it.
    body.task = input.task.trim();
  }
  if (input.projectId !== undefined) body.projectId = uuid(input.projectId, "projectId", "list_projects");
  for (const name of ["startedAt", "endedAt"]) {
    const value = input[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || !INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
      throw new Error(`${name} must be an ISO 8601 time with a timezone offset, like 2026-10-08T09:00:00+02:00.`);
    }
    body[name] = new Date(value).toISOString();
  }
  if (Object.keys(body).length === 0) throw new Error("Pass at least one of task, projectId, startedAt and endedAt.");
  const [entry, list] = await Promise.all([api<Entry>(`/time-entries/${entryId}`, { method: "PATCH", body }), api<Project[]>("/projects")]);
  void refresh();
  void wings.broadcast({ type: "timers-changed" });
  return { updated: true, entry: entryInfo(entry, new Map(list.map((p) => [p.id, p]))) };
});

wings.onTool("delete_entry", async ({ entryId }) => {
  const id = uuid(entryId, "entryId", "list_entries or running_timers");
  await api(`/time-entries/${id}`, { method: "DELETE" });
  void refresh();
  void wings.broadcast({ type: "timers-changed" });
  return { deleted: true, entryId: id };
});
