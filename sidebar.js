// @ts-check
/// <reference path="./wings.d.ts" />

// The Cyclops sidebar: connect with a personal API token, start and stop timers, and see the week.
// Every request goes through wings.fetch, which adds the token in Wings, so this page never holds it.

const API = "https://cyclops-api.prototyp.digital/api";
const WEB = "https://cyclops.prototyp.digital";
const app = /** @type {HTMLElement} */ (document.getElementById("app"));

class SignedOut extends Error {}

/** @typedef {{ task: string, projectIds: string[], lastUsedAt: number }} Suggestion */
/** @type {{ phase: "loading" | "connect" | "ready", me: any, projects: any[], timers: any[], week: any[], history: Map<string, Suggestion>, error: string | null, busy: Set<string>, task: string, projectId: string }} */
const state = { phase: "loading", me: null, projects: [], timers: [], week: [], history: new Map(), error: null, busy: new Set(), task: "", projectId: "" };

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
/** Monday of this week, or of a week before it. */
function weekStart(weeksBack = 0) {
  const [y, m, d] = today().split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) - 7 * weeksBack);
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
    await Promise.all([refresh(), loadHistory()]);
    set({ phase: "ready" });
  } catch (error) {
    if (error instanceof SignedOut) return set({ phase: "connect", error: "Cyclops didn't accept the saved token. Connect again." });
    set({ phase: state.phase === "loading" ? "connect" : state.phase, error: String(error.message ?? error) });
  }
}

// Task suggestions come from the last 8 weeks, like the Cyclops web app. That one keeps them in localStorage,
// which a sandboxed page can't use, so they load once per open instead.
async function loadHistory() {
  remember(await api(`/time-entries?from=${weekStart(7)}`));
}

/** Adds entries' tasks to the suggestions: one per task ignoring case, with every project it was logged on. */
function remember(entries) {
  for (const entry of entries) {
    const task = entry.task?.trim();
    const lastUsedAt = Date.parse(entry.startedAt);
    if (!task || Number.isNaN(lastUsedAt)) continue;
    const key = task.toLowerCase();
    const old = state.history.get(key);
    const projectIds = old ? [...new Set([...old.projectIds, entry.projectId])] : [entry.projectId];
    const newer = !old || lastUsedAt > old.lastUsedAt;
    state.history.set(key, { task: newer ? task : old.task, projectIds, lastUsedAt: newer ? lastUsedAt : old.lastUsedAt });
  }
}

/** Up to 8 tasks containing `query`, the selected project's first, then the most recent. */
function suggest(query) {
  const q = query.trim().toLowerCase();
  const has = (/** @type {Suggestion} */ s) => s.projectIds.includes(state.projectId);
  return [...state.history.values()]
    .filter((s) => !q || s.task.toLowerCase().includes(q))
    .sort((a, b) => (state.projectId && has(a) !== has(b) ? (has(a) ? -1 : 1) : b.lastUsedAt - a.lastUsedAt))
    .slice(0, 8);
}

async function refresh() {
  const [timers, week] = await Promise.all([api("/time-entries/timers"), api(`/time-entries?from=${weekStart()}&to=${today()}`)]);
  state.timers = timers;
  state.week = week;
  remember([...timers, ...week]);
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
              await loadHistory();
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

// ---------- fields with suggestions ----------

/** Open state of each field with a list, kept across renders. @type {Record<string, { open: boolean, active: number, query: string }>} */
const boxes = {};
/** The fields on the page now, so a click elsewhere can close their lists. @type {Map<string, { root: HTMLElement, close: () => void }>} */
const liveBoxes = new Map();
let restoringFocus = false;

document.addEventListener("mousedown", (e) => {
  for (const box of liveBoxes.values()) if (!box.root.contains(/** @type {Node} */ (e.target))) box.close();
});

/**
 * A text field with a list of options under it, with the same keys as the Cyclops web app: arrows move,
 * Enter picks the highlighted option, Escape and Tab close. `freeText` fields keep whatever you type and start
 * with nothing highlighted; the others pick one of their options and start on the first.
 * @param {{ id: string, label: string, placeholder: string, freeText: boolean, text: () => string, onInput?: (value: string) => void,
 *   options: (query: string) => { key: string, label: string, detail?: string }[], onPick: (key: string, label: string) => void, empty: (query: string) => string }} o
 */
function combobox(o) {
  const ui = (boxes[o.id] ??= { open: false, active: -1, query: "" });
  const first = o.freeText ? -1 : 0;
  const listId = `${o.id}-list`;
  const optionId = (/** @type {number} */ i) => `${o.id}-opt-${i}`;
  /** @type {{ key: string, label: string, detail?: string }[]} */
  let items = [];
  const input = /** @type {HTMLInputElement} */ (
    h("input", { id: o.id, role: "combobox", "aria-label": o.label, "aria-autocomplete": "list", "aria-controls": listId, placeholder: o.placeholder, autocomplete: "off", spellcheck: "false", maxlength: 2000 })
  );
  const list = h("ul", { id: listId, role: "listbox", class: "options" });
  const root = h("div", { class: "combo grow" }, input, list);
  const query = () => (o.freeText ? input.value : ui.query);

  function highlight(/** @type {number} */ i, scroll = false) {
    ui.active = i;
    [...list.children].forEach((li, n) => {
      li.classList.toggle("active", n === i);
      if (li.getAttribute("role") === "option") li.setAttribute("aria-selected", String(n === i));
    });
    if (i >= 0 && items[i]) {
      input.setAttribute("aria-activedescendant", optionId(i));
      if (scroll) list.children[i]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function draw() {
    input.setAttribute("aria-expanded", String(ui.open));
    list.hidden = !ui.open;
    if (!ui.open) return highlight(-1);
    items = o.options(query());
    list.replaceChildren(
      ...(items.length
        ? items.map((item, i) =>
            h(
              "li",
              {
                id: optionId(i),
                role: "option",
                onmousedown: (/** @type {MouseEvent} */ e) => {
                  e.preventDefault();
                  pick(item);
                },
                onmousemove: () => ui.active !== i && highlight(i),
              },
              h("span", { class: "label" }, item.label),
              item.detail ? h("span", { class: "detail" }, item.detail) : null,
            ),
          )
        : [h("li", { role: "status", class: "empty" }, o.empty(query()))]),
    );
    highlight(Math.min(ui.active, items.length - 1), true);
  }

  function close() {
    if (!ui.open) return;
    ui.open = false;
    ui.query = "";
    if (!o.freeText) input.value = o.text();
    draw();
  }

  function pick(/** @type {{ key: string, label: string }} */ item) {
    o.onPick(item.key, item.label);
    if (o.freeText) input.value = item.label;
    ui.open = false;
    ui.query = "";
    if (!o.freeText) input.value = o.text();
    draw();
  }

  input.value = o.freeText || !ui.open ? o.text() : ui.query;
  input.addEventListener("focus", () => {
    if (restoringFocus) return;
    ui.open = true;
    ui.active = first;
    if (!o.freeText) input.value = ui.query = "";
    draw();
  });
  input.addEventListener("input", () => {
    if (o.freeText) o.onInput?.(input.value);
    else ui.query = input.value;
    ui.open = true;
    ui.active = first;
    draw();
  });
  input.addEventListener("blur", (e) => {
    const next = /** @type {Node | null} */ (e.relatedTarget);
    if (next && !root.contains(next)) close();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const wasOpen = ui.open;
      ui.open = true;
      if (!wasOpen) draw();
      // A closed free-text field moves to the first option at once; a closed picker opens on its highlight.
      if (wasOpen || o.freeText) highlight(Math.min(ui.active + 1, items.length - 1), true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight(Math.max(ui.active - 1, first), true);
    } else if (e.key === "Enter" && ui.open && ui.active >= 0 && items[ui.active]) {
      // Picking from the list doesn't also submit the form.
      e.preventDefault();
      pick(items[ui.active]);
    } else if (e.key === "Escape" || e.key === "Tab") {
      close();
    }
  });
  liveBoxes.set(o.id, { root, close });
  draw();
  return root;
}

const projectLabel = (p) => `${p.name} · ${p.clientName}`;

function renderStart() {
  const busy = state.busy.has("start");
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
    combobox({
      id: "task",
      label: "What are you working on?",
      placeholder: "What are you working on?",
      freeText: true,
      text: () => state.task,
      onInput: (value) => (state.task = value),
      options: (query) => suggest(query).map((s) => ({ key: s.task, label: s.task })),
      onPick: (task) => (state.task = task),
      empty: (query) => (query.trim() ? "No matching tasks." : "No recent tasks yet."),
    }),
    h(
      "div",
      { class: "row" },
      combobox({
        id: "project",
        label: "Project",
        placeholder: "Find a project or client",
        freeText: false,
        text: () => {
          const p = state.projects.find((x) => x.id === state.projectId);
          return p ? projectLabel(p) : "";
        },
        options: (query) => {
          const q = query.trim().toLowerCase();
          return state.projects
            .filter((p) => !q || p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q))
            .map((p) => ({ key: p.id, label: p.name, detail: p.clientName }));
        },
        onPick: (id) => (state.projectId = id),
        empty: () => "No matching projects.",
      }),
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
  liveBoxes.clear();
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
    restoringFocus = true;
    el?.focus();
    restoringFocus = false;
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
