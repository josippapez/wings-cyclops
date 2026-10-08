// Keeps the running timer on the clock button while the sidebar is closed, and runs the tools Claude calls.

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

async function runningLabel() {
  if (!(await wings.secrets.has("token"))) return null;
  const timers = await api("/time-entries/timers");
  if (timers.length === 0) return null;
  const startedAt = Math.min(...timers.map((t) => Date.parse(t.startedAt)));
  const minutes = Math.floor((Date.now() - startedAt) / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

async function refresh() {
  try {
    await wings.setSidebarLabel("tracker", await runningLabel());
  } catch (error) {
    console.error(error);
  }
}

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
  return { stopped: true, timerId: id };
});
