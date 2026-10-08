// @ts-check
/// <reference path="./wings.d.ts" />

// The Cyclops sidebar: connect with a personal API token, start and stop timers, and see the week.
// Every request goes through wings.fetch, which adds the token in Wings, so this page never holds it.

const API = "https://cyclops-api.prototyp.digital/api";
const WEB = "https://cyclops.prototyp.digital";
const app = /** @type {HTMLElement} */ (document.getElementById("app"));

class SignedOut extends Error {}

/** @type {{ phase: "loading" | "connect" | "ready", me: any, projects: any[], timers: any[], week: any[], error: string | null, busy: Set<string>, task: string, projectId: string }} */
const state = { phase: "loading", me: null, projects: [], timers: [], week: [], error: null, busy: new Set(), task: "", projectId: "" };

// ---------- API ----------

/** @param {string} path @param {{ method?: string, body?: object }} [options] */
async function api(path, { method = "GET", body } = {}, retried = false) {
  const res = await wings.fetch(API + path, {
    method,
    bearer: "token",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new SignedOut();
  const data = res.body ? safeJson(res.body) : null;
  const message = typeof data?.message === "string" ? data.message : Array.isArray(data?.message) ? data.message.join(", ") : "";
  // Cyclops says a 409 ending in "try again" is a lost race worth one plain retry.
  if (res.status === 409 && /try again$/i.test(message) && !retried) return api(path, { method, body }, true);
  if (res.status === 429) throw new Error("Cyclops is limiting requests from this token. Try again in a minute.");
  if (res.status >= 400) throw new Error(message || `Cyclops answered ${res.status}`);
  return data;
}

/** @param {string} text */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- dates, in the user's own timezone ----------

const tz = () => state.me?.timezone || "Europe/Zagreb";
/** YYYY-MM-DD in the user's timezone. @param {Date} date */
const dayOf = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz() }).format(date);
const today = () => dayOf(new Date());
function weekStart() {
  const [y, m, d] = today().split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
/** @param {string} iso */
const clockTime = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
/** @param {number} minutes */
function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
/** @param {string} startedAt */
function elapsed(startedAt) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
}
const runningMinutes = () => state.timers.reduce((sum, t) => sum + (Date.now() - Date.parse(t.startedAt)) / 60_000, 0);

// ---------- loading ----------

async function load() {
  try {
    if (!(await wings.secrets.has("token"))) return set({ phase: "connect" });
    const [me, projects] = await Promise.all([api("/auth/me"), api("/projects")]);
    state.me = me;
    state.projects = projects;
    await refresh();
    set({ phase: "ready" });
  } catch (error) {
    if (error instanceof SignedOut) return set({ phase: "connect", error: "Cyclops didn't accept the saved token. Connect again." });
    set({ phase: state.phase === "loading" ? "connect" : state.phase, error: String(error.message ?? error) });
  }
}

async function refresh() {
  const [timers, week] = await Promise.all([api("/time-entries/timers"), api(`/time-entries?from=${weekStart()}&to=${today()}`)]);
  state.timers = timers;
  state.week = week;
  if (!state.projectId) state.projectId = timers[0]?.projectId ?? week[0]?.projectId ?? state.projects[0]?.id ?? "";
  void wings.setSidebarLabel("tracker", label());
}

/** Runs an action with its button showing progress, then reloads. @param {string} key @param {() => Promise<unknown>} task */
async function act(key, task) {
  state.busy.add(key);
  set({ error: null });
  try {
    await task();
    await refresh();
  } catch (error) {
    if (error instanceof SignedOut) return set({ phase: "connect", error: "Cyclops didn't accept the saved token. Connect again." });
    state.error = String(error.message ?? error);
  } finally {
    state.busy.delete(key);
    render();
  }
}

function label() {
  if (state.timers.length === 0) return null;
  const minutes = Math.floor(Math.max(...state.timers.map((t) => (Date.now() - Date.parse(t.startedAt)) / 60_000)));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// ---------- rendering ----------

/** @param {Partial<typeof state>} patch */
function set(patch) {
  Object.assign(state, patch);
  render();
}

/** A small element builder: strings become text, never HTML. @param {string} tag @param {Record<string, any>} [props] @param {...(Node | string | null | false)} children */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false && value != null) el.setAttribute(key, String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

const projectName = (id) => {
  const p = state.projects.find((x) => x.id === id);
  return p ? `${p.clientName} · ${p.name}` : "Unknown project";
};

/** @param {string} id */
const projectLine = (id) => h("div", { class: "project" }, h("span", {}, projectName(id)));

function renderConnect() {
  let token = "";
  const busy = state.busy.has("connect");
  return h(
    "section",
    { class: "card connect" },
    h("h1", {}, "Connect Cyclops"),
    h("p", { class: "muted" }, "Make a personal API token in Cyclops Settings, then paste it here. Wings keeps it in your keychain."),
    h("button", { class: "ghost", style: "align-self: flex-start", onclick: () => void wings.openUrl(`${WEB}/settings`) }, "Open Cyclops Settings"),
    h(
      "form",
      {
        class: "stack",
        onsubmit: (/** @type {SubmitEvent} */ e) => {
          e.preventDefault();
          if (!token.trim()) return;
          void act("connect", async () => {
            await wings.secrets.set("token", token.trim());
            try {
              state.me = await api("/auth/me");
              state.projects = await api("/projects");
            } catch (error) {
              await wings.secrets.delete("token");
              throw error instanceof SignedOut ? new Error("That token didn't work. Check it's a Cyclops API token starting with cyc_.") : error;
            }
            state.phase = "ready";
          });
        },
      },
      h("input", { type: "password", placeholder: "cyc_…", autocomplete: "off", "aria-label": "API token", oninput: (e) => (token = e.target.value) }),
      h("button", { class: "primary", type: "submit", disabled: busy }, busy ? h("span", { class: "spinner", "aria-hidden": true }) : null, busy ? "Connecting…" : "Connect"),
    ),
  );
}

function renderTimer(timer) {
  const key = `stop:${timer.id}`;
  return h(
    "section",
    { class: "card timer" },
    h("div", { class: "row" }, h("div", { class: "grow task" }, timer.task || "No description"), h("div", { class: "clock", "data-started": timer.startedAt }, elapsed(timer.startedAt))),
    h(
      "div",
      { class: "row" },
      h("div", { class: "grow" }, projectLine(timer.projectId)),
      h("button", { class: "danger", disabled: state.busy.has(key), onclick: () => void act(key, () => api(`/time-entries/${timer.id}/stop`, { method: "POST" })) }, state.busy.has(key) ? "Stopping…" : "Stop"),
    ),
  );
}

function renderStart() {
  const busy = state.busy.has("start");
  const groups = new Map();
  for (const p of state.projects) groups.set(p.clientName, [...(groups.get(p.clientName) ?? []), p]);
  return h(
    "form",
    {
      class: "card stack",
      style: "padding: 12px",
      onsubmit: (/** @type {SubmitEvent} */ e) => {
        e.preventDefault();
        if (!state.projectId) return;
        const task = state.task.trim();
        // Cyclops refuses empty fields, so a blank description is left out rather than sent as "".
        void act("start", async () => {
          await api("/time-entries/timer", { method: "POST", body: task ? { projectId: state.projectId, task } : { projectId: state.projectId } });
          state.task = "";
        });
      },
    },
    h("input", { id: "task", placeholder: "What are you working on?", value: state.task, maxlength: 2000, "aria-label": "What are you working on?", oninput: (e) => (state.task = e.target.value) }),
    h(
      "div",
      { class: "row" },
      h(
        "select",
        { class: "grow", "aria-label": "Project", onchange: (e) => (state.projectId = e.target.value) },
        ...[...groups].map(([client, list]) =>
          h("optgroup", { label: client }, ...list.map((p) => h("option", { value: p.id, selected: p.id === state.projectId }, p.name))),
        ),
      ),
      h("button", { class: "primary", type: "submit", disabled: busy || !state.projectId }, busy ? "Starting…" : "Start"),
    ),
  );
}

function renderEntries() {
  const day = today();
  const done = state.week.filter((e) => e.endedAt);
  const todays = done.filter((e) => e.entryDate === day);
  const sum = (list) => list.reduce((n, e) => n + (e.durationMinutes ?? 0), 0);
  const running = runningMinutes();
  return h(
    "section",
    { class: "stack" },
    h("div", { class: "section-title" }, h("span", {}, "Today"), h("span", { id: "today-total" }, duration(sum(todays) + running))),
    todays.length === 0
      ? h("p", { class: "muted" }, "Nothing logged today yet.")
      : h(
          "ul",
          { class: "entries" },
          ...todays.map((e) => {
            const key = `resume:${e.id}`;
            return h(
              "li",
              { class: "entry" },
              h("div", { class: "what" }, h("div", { class: "task" }, e.task || "No description"), projectLine(e.projectId)),
              h(
                "button",
                {
                  class: "ghost",
                  "aria-label": `Resume ${e.task || "entry"}`,
                  disabled: state.busy.has(key),
                  onclick: () =>
                    void act(key, () => api("/time-entries/timer", { method: "POST", body: e.task ? { projectId: e.projectId, task: e.task } : { projectId: e.projectId } })),
                },
                "Resume",
              ),
              h("div", { class: "when" }, h("strong", {}, duration(e.durationMinutes ?? 0)), `${clockTime(e.startedAt)}–${clockTime(e.endedAt)}`),
            );
          }),
        ),
    h("div", { class: "section-title" }, h("span", {}, "This week"), h("span", { id: "week-total" }, duration(sum(done) + running))),
  );
}

function render() {
  // Rendering replaces the page, so keep the caret in the field you're typing in.
  const focused = document.activeElement?.id;
  const caret = document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionStart : null;
  const parts = [];
  if (state.phase === "loading") parts.push(h("div", { class: "row muted" }, h("span", { class: "spinner", "aria-hidden": true }), "Loading Cyclops…"));
  if (state.phase === "connect") parts.push(renderConnect());
  if (state.phase === "ready") {
    parts.push(
      h(
        "div",
        { class: "row who" },
        h("span", { class: "grow muted" }, state.me?.name ?? ""),
        h("button", { class: "ghost", onclick: () => void wings.openUrl(WEB) }, "Open Cyclops"),
        h(
          "button",
          {
            class: "ghost",
            title: "Removes the token from this Mac. It stays valid until you revoke it in Cyclops Settings.",
            onclick: async () => {
              await wings.secrets.delete("token");
              void wings.setSidebarLabel("tracker", null);
              set({ phase: "connect", me: null, timers: [], week: [] });
            },
          },
          "Sign out",
        ),
      ),
      ...state.timers.map(renderTimer),
      renderStart(),
      renderEntries(),
    );
  }
  if (state.error) parts.push(h("p", { class: "error", role: "alert" }, state.error));
  app.replaceChildren(...parts);
  if (focused) {
    const el = document.getElementById(focused);
    el?.focus();
    if (el instanceof HTMLInputElement && caret != null) el.setSelectionRange(caret, caret);
  }
}

// Running clocks tick every second without a reload; the data refreshes every minute.
setInterval(() => {
  for (const el of document.querySelectorAll("[data-started]")) el.textContent = elapsed(/** @type {HTMLElement} */ (el).dataset.started ?? "");
}, 1000);
setInterval(() => {
  if (state.phase === "ready" && state.busy.size === 0) void refresh().then(render, () => {});
}, 60_000);

render();
void load();
