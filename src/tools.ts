// The tools Claude gets. The build writes them into `contributes.mcpTools` of the manifest.

import { s, tool } from "wings-plugin-sdk/tools";

import { today } from "./lib/dates";
import type { Entry, Project } from "./lib/types";
import { api } from "./main/api";
import { changed, profile } from "./main/label";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Cyclops reads a time without an offset in its server's own timezone, so one is required.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

// The schema holds a string's length only, so its format is checked here.
function uuid(value: string, name: string, source: string) {
  if (!UUID.test(value)) throw new Error(`${name} must be an id from ${source}.`);
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

export const tools = {
  list_projects: tool({
    description: "Lists the Cyclops projects you can track time on, with each project's id and client.",
    run: async () => (await api<Project[]>("/projects")).map(projectInfo),
  }),

  running_timers: tool({
    description: "Lists your running Cyclops timers with their id, project, task and start time.",
    run: async () => {
      const running = await timers();
      return running.length ? running : "No timer is running.";
    },
  }),

  start_timer: tool({
    description: "Starts a Cyclops timer. Get the projectId from list_projects.",
    input: s.object({
      projectId: s.string({ format: "uuid" }).describe("The project to track time on"),
      task: s.string({ maxLength: 2000 }).describe("What you're working on").optional(),
    }),
    run: async ({ projectId, task }) => {
      const text = task?.trim() ?? "";
      const timer = await api<Entry | null>("/time-entries/timer", { method: "POST", body: text ? { projectId, task: text } : { projectId } });
      changed();
      return { started: true, timerId: timer?.id ?? null, projectId, task: text || null };
    },
  }),

  stop_timer: tool({
    description: "Stops your running Cyclops timer. Pass timerId when more than one runs.",
    input: s.object({ timerId: s.string().describe("The timer to stop, from running_timers").optional() }),
    run: async ({ timerId }) => {
      let id = timerId ?? null;
      if (!id) {
        const running = await timers();
        if (running.length === 0) return "No timer is running.";
        if (running.length > 1) throw new Error(`${running.length} timers are running. Pass timerId, from running_timers.`);
        id = running[0].id;
      }
      await api(`/time-entries/${encodeURIComponent(id)}/stop`, { method: "POST" });
      changed();
      return { stopped: true, timerId: id };
    },
  }),

  list_entries: tool({
    description:
      "Lists your Cyclops time entries between two days, with each entry's id, task, project, client, start, end and minutes. A running timer has no end. Use it to find the entryId for update_entry and delete_entry.",
    input: s.object({
      from: s.string({ format: "date" }).describe("First day, YYYY-MM-DD. Defaults to today, or to `to` when only that is given").optional(),
      to: s.string({ format: "date" }).describe("Last day, YYYY-MM-DD, included. Defaults to today, or to `from` when that is later").optional(),
    }),
    run: async ({ from, to }) => {
      for (const [name, value] of Object.entries({ from, to })) {
        if (value !== undefined && !DAY.test(value)) throw new Error(`${name} must be a date like 2026-10-08.`);
      }
      await profile();
      const first = from ?? to ?? today();
      const last = to ?? (first > today() ? first : today());
      if (first > last) throw new Error("from must be on or before to.");
      const [entries, list] = await Promise.all([api<Entry[]>(`/time-entries?from=${first}&to=${last}`), api<Project[]>("/projects")]);
      const byId = new Map(list.map((p) => [p.id, p]));
      return entries.length ? entries.map((e) => entryInfo(e, byId)) : `No entries from ${first} to ${last}.`;
    },
  }),

  update_entry: tool({
    description: "Changes a Cyclops time entry or running timer. Pass only the fields to change. Get the entryId from list_entries or running_timers.",
    input: s.object({
      entryId: s.string({ format: "uuid" }).describe("The entry to change"),
      task: s.string({ maxLength: 2000 }).describe("What was worked on. An empty string clears it").optional(),
      projectId: s.string({ format: "uuid" }).describe("Move the entry to this project, from list_projects").optional(),
      startedAt: s.string({ format: "date-time" }).describe("New start, ISO 8601 with a timezone offset, like 2026-10-08T09:00:00+02:00. A running timer can't start in the future").optional(),
      endedAt: s.string({ format: "date-time" }).describe("New end, ISO 8601 with a timezone offset, after the start. Setting it on a running timer stops the timer").optional(),
    }),
    run: async (input) => {
      const entryId = uuid(input.entryId, "entryId", "list_entries or running_timers");
      const body: Record<string, string> = {};
      // An empty task clears it.
      if (input.task !== undefined) body.task = input.task.trim();
      if (input.projectId !== undefined) body.projectId = uuid(input.projectId, "projectId", "list_projects");
      for (const name of ["startedAt", "endedAt"] as const) {
        const value = input[name];
        if (value === undefined) continue;
        if (!INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
          throw new Error(`${name} must be an ISO 8601 time with a timezone offset, like 2026-10-08T09:00:00+02:00.`);
        }
        body[name] = new Date(value).toISOString();
      }
      if (Object.keys(body).length === 0) throw new Error("Pass at least one of task, projectId, startedAt and endedAt.");
      const [entry, list] = await Promise.all([api<Entry>(`/time-entries/${entryId}`, { method: "PATCH", body }), api<Project[]>("/projects")]);
      changed();
      return { updated: true, entry: entryInfo(entry, new Map(list.map((p) => [p.id, p]))) };
    },
  }),

  delete_entry: tool({
    description: "Permanently deletes a Cyclops time entry, or a running timer without saving its time. This can't be undone. Get the entryId from list_entries or running_timers.",
    input: s.object({ entryId: s.string({ format: "uuid" }).describe("The entry to delete") }),
    run: async ({ entryId }) => {
      const id = uuid(entryId, "entryId", "list_entries or running_timers");
      await api(`/time-entries/${id}`, { method: "DELETE" });
      changed();
      return { deleted: true, entryId: id };
    },
  }),
};
