// Keeps the running timer on the clock button while the sidebar is closed.

const API = "https://cyclops-api.prototyp.digital/api";

async function runningLabel() {
  if (!(await wings.secrets.has("token"))) return null;
  const res = await wings.fetch(`${API}/time-entries/timers`, { bearer: "token" });
  if (res.status !== 200) return null;
  const timers = JSON.parse(res.body);
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
