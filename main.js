// Keeps the running timer on the clock button, with details when you point at it, and runs the tools Claude
// calls. The sidebar and this script tell each other about changes with wings.broadcast, so a timer started
// in one shows in the other at once. Changes made on the Cyclops website show on the next 30 s poll.

const API = "https://cyclops-api.prototyp.digital/api";

async function api(path, { method = "GET", body } = {}, retried = false) {
  if (!(await wings.secrets.has("token"))) throw new Error("Cyclops isn't connected. Open the Cyclops sidebar in Wings and connect it.");
  const res = await wings.fetch(API + path, {
    method,
    bearer: "token",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = res.body ? JSON.parse(res.body) : null;
  } catch {}
  const message = typeof data?.message === "string" ? data.message : Array.isArray(data?.message) ? data.message.join(", ") : "";
  // Cyclops says a 409 ending in "try again" is a lost race worth one plain retry.
  if (res.status === 409 && /try again$/i.test(message) && !retried) return api(path, { method, body }, true);
  if (res.status === 401) throw new Error("Cyclops didn't accept the saved token. Connect again in the Cyclops sidebar.");
  if (res.status >= 400) throw new Error(message || `Cyclops answered ${res.status}`);
  return data;
}

/** Projects by id, loaded when a timer's project isn't known yet. @type {Map<string, any> | null} */
let projects = null;
const today = () => new Intl.DateTimeFormat("en-CA").format(new Date());
const clockTime = (iso) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

async function refresh() {
  try {
    if (!(await wings.secrets.has("token"))) return void (await wings.setSidebarLabel("tracker", null));
    const timers = await api("/time-entries/timers");
    if (timers.length === 0) return void (await wings.setSidebarLabel("tracker", null));
    const [entries] = await Promise.all([
      api(`/time-entries?from=${today()}&to=${today()}`),
      projects && timers.every((t) => projects?.has(t.projectId)) ? null : api("/projects").then((list) => (projects = new Map(list.map((p) => [p.id, p])))),
    ]);
    const first = timers.reduce((a, b) => (Date.parse(a.startedAt) <= Date.parse(b.startedAt) ? a : b));
    const since = (t) => (Date.now() - Date.parse(t.startedAt)) / 60_000;
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
  if (message?.type === "timers-changed") void refresh();
});

void refresh();
// Two requests a minute stay far below Cyclops's limit of 100 per token.
setInterval(refresh, 30_000);

// ---------- tools for Claude ----------

const projectInfo = (p) => ({ id: p.id, name: p.name, client: p.clientName });

async function timers() {
  const [running, projects] = await Promise.all([api("/time-entries/timers"), api("/projects")]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  return running.map((t) => ({
    id: t.id,
    project: byId.get(t.projectId)?.name ?? t.projectId,
    client: byId.get(t.projectId)?.clientName ?? null,
    task: t.task || null,
    startedAt: t.startedAt,
  }));
}

wings.onTool("list_projects", async () => (await api("/projects")).map(projectInfo));

wings.onTool("running_timers", async () => {
  const running = await timers();
  return running.length ? running : "No timer is running.";
});

wings.onTool("start_timer", async ({ projectId, task }) => {
  if (typeof projectId !== "string") throw new Error("projectId is required. Get one from list_projects.");
  const text = typeof task === "string" ? task.trim() : "";
  const timer = await api("/time-entries/timer", { method: "POST", body: text ? { projectId, task: text } : { projectId } });
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
