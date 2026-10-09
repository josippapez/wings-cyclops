// @ts-check
/// <reference path="./wings.d.ts" />

// The Cyclops sidebar: connect with a personal API token, start and stop timers, and see the week.
// Every request goes through wings.fetch, which adds the token in Wings, so this page never holds it.

const API = "https://cyclops-api.prototyp.digital/api";
const WEB = "https://cyclops.prototyp.digital";
const app = /** @type {HTMLElement} */ (document.getElementById("app"));

class SignedOut extends Error {}

/** @typedef {{ task: string, projectIds: string[], lastUsedAt: number }} Suggestion */
/** An entry being edited, with its times as HH:MM on `day` in the user's timezone. @typedef {{ id: string, running: boolean, day: string, task: string, projectId: string, start: string, end: string }} Draft */
/**
 * `weeks` holds each week's entries by its Monday, once loaded. `day` is the day being looked at, or null to follow today.
 * `wholeWeek` lists every day of that day's week instead, like the Cyclops web app.
 * @type {{ phase: "loading" | "connect" | "ready", me: any, projects: any[], timers: any[], weeks: Map<string, any[]>, day: string | null, wholeWeek: boolean, weekError: { week: string, message: string } | null, history: Map<string, Suggestion>, error: string | null, busy: Set<string>, task: string, projectId: string, editing: Draft | null, confirming: string | null }}
 */
const state = { phase: "loading", me: null, projects: [], timers: [], weeks: new Map(), day: null, wholeWeek: false, weekError: null, history: new Map(), error: null, busy: new Set(), task: "", projectId: "", editing: null, confirming: null };

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
/** @param {string} day YYYY-MM-DD @param {number} n */
function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** The Monday of a day's week. @param {string} day YYYY-MM-DD */
const mondayOf = (day) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
/** Monday of this week, or of a week before it. */
const weekStart = (weeksBack = 0) => addDays(mondayOf(today()), -7 * weeksBack);
/** A YYYY-MM-DD day in words. It's a day in the user's timezone already, so it's formatted as UTC. @param {string} day @param {Intl.DateTimeFormatOptions} options */
const dayLabel = (day, options) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(`${day}T00:00:00Z`));
/** "5 Oct – 11 Oct", with the years when the week isn't in this one, as in the Cyclops web app. @param {string} monday */
function weekRange(monday) {
  const sunday = addDays(monday, 6);
  const year = today().slice(0, 4);
  /** @type {Intl.DateTimeFormatOptions} */
  const options = { day: "numeric", month: "short", year: monday.startsWith(year) && sunday.startsWith(year) ? undefined : "numeric" };
  return `${dayLabel(monday, options)} – ${dayLabel(sunday, options)}`;
}
/** "Today", or a day like "Wed 7 Oct". @param {string} day */
const dayName = (day) => (day === today() ? "Today" : dayLabel(day, { weekday: "short", day: "numeric", month: "short", year: day.startsWith(today().slice(0, 4)) ? undefined : "numeric" }));
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
/** How far the user's timezone is ahead of UTC at an instant, in ms. @param {number} t */
function offsetAt(t) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz(), hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(t);
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
/** The instant a wall-clock time on a day has in the user's timezone. @param {string} day YYYY-MM-DD @param {string} time HH:MM */
function atTime(day, time) {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // The offset depends on the instant being looked for, so correct the guess once more for a DST change.
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - offsetAt(t);
  return new Date(t);
}

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

/** Up to 8 tasks containing `query`, the selected project's first, then the most recent. @param {string} query @param {string} projectId */
function suggest(query, projectId) {
  const q = query.trim().toLowerCase();
  const has = (/** @type {Suggestion} */ s) => s.projectIds.includes(projectId);
  return [...state.history.values()]
    .filter((s) => !q || s.task.toLowerCase().includes(q))
    .sort((a, b) => (projectId && has(a) !== has(b) ? (has(a) ? -1 : 1) : b.lastUsedAt - a.lastUsedAt))
    .slice(0, 8);
}

const selectedDay = () => state.day ?? today();
const shownWeek = () => mondayOf(selectedDay());
/** @param {string} monday */
const weekPath = (monday) => `/time-entries?from=${monday}&to=${addDays(monday, 6)}`;

/** Reloads the timers and this week, and with `shown` also the earlier week on screen. */
async function refresh(shown = false) {
  const current = weekStart();
  // A week that isn't loaded yet is loadWeek's to fetch.
  const other = shown && shownWeek() !== current && state.weeks.has(shownWeek()) ? shownWeek() : null;
  const [timers, week, older] = await Promise.all([api("/time-entries/timers"), api(weekPath(current)), other ? api(weekPath(other)) : null]);
  state.timers = timers;
  state.weeks.set(current, week);
  if (other) state.weeks.set(other, older);
  remember([...timers, ...week, ...(older ?? [])]);
  if (!state.projectId) state.projectId = timers[0]?.projectId ?? week[0]?.projectId ?? state.projects[0]?.id ?? "";
}

/** The Monday being fetched. One week loads at a time, so clicking quickly through weeks only asks for the one you stop on. @type {string | null} */
let loadingWeek = null;

/** Fetches the week on screen unless it's loaded, or failed until you try again. */
async function loadWeek() {
  const monday = shownWeek();
  if (loadingWeek || state.weeks.has(monday) || state.weekError?.week === monday) return;
  loadingWeek = monday;
  try {
    const entries = await api(weekPath(monday));
    state.weeks.set(monday, entries);
    remember(entries);
  } catch (error) {
    if (error instanceof SignedOut) return set({ phase: "connect", error: "Cyclops didn't accept the saved token. Connect again." });
    state.weekError = { week: monday, message: String(error.message ?? error) };
  } finally {
    loadingWeek = null;
  }
  render();
  // You may have moved to another week while this one loaded.
  void loadWeek();
}

/** Shows a day, or today for null, and loads its week. @param {string | null} day */
function show(day) {
  state.day = day && day < today() ? day : null;
  state.weekError = null;
  // An entry being edited or deleted goes off screen. A running timer's stays.
  if (state.editing && !state.editing.running) state.editing = null;
  if (state.confirming && !state.timers.some((t) => t.id === state.confirming)) state.confirming = null;
  render();
  void loadWeek();
}

/** Runs an action with its button showing progress, then reloads. @param {string} key @param {() => Promise<unknown>} task */
async function act(key, task) {
  state.busy.add(key);
  set({ error: null });
  try {
    await task();
    // The main script keeps the title bar button current.
    void wings.broadcast({ type: "timers-changed" });
    await refresh(true);
  } catch (error) {
    if (error instanceof SignedOut) return set({ phase: "connect", error: "Cyclops didn't accept the saved token. Connect again." });
    state.error = String(error.message ?? error);
  } finally {
    state.busy.delete(key);
    render();
  }
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

const SVG = "http://www.w3.org/2000/svg";
/** The Cyclops web app's row icons, and arrows for the weeks. */
const ICONS = {
  resume: { size: 12, stroke: 1, paths: ["M9.79363 5.14742L3.77252 1.45752C3.10619 1.04918 2.25 1.52866 2.25 2.31015V9.68987C2.25 10.4714 3.10618 10.9508 3.77251 10.5425L9.79362 6.85269C10.4303 6.46254 10.4303 5.53758 9.79363 5.14742Z"] },
  edit: { size: 12, stroke: 1, paths: ["M10.161 1.83896C10.92 2.59796 10.92 3.82996 10.161 4.58896L5.38 9.36997C5.131 9.61897 4.821 9.79798 4.481 9.88798L1.25 10.75L2.112 7.51896C2.203 7.17896 2.381 6.86897 2.63 6.61997L7.411 1.83896C8.17 1.07996 9.402 1.07996 10.161 1.83896Z"] },
  previous: { size: 12, stroke: 1.25, paths: ["M7.5 2.5L4 6L7.5 9.5"] },
  next: { size: 12, stroke: 1.25, paths: ["M4.5 2.5L8 6L4.5 9.5"] },
  delete: {
    size: 18,
    stroke: 1.5,
    paths: [
      "M13.6977 7.75L13.35 14.35C13.294 15.4201 12.416 16.25 11.353 16.25H6.64804C5.58404 16.25 4.70703 15.42 4.65103 14.35L4.30334 7.75",
      "M2.75 4.75H15.25",
      "M6.75 4.75V2.75C6.75 2.2 7.198 1.75 7.75 1.75H10.25C10.802 1.75 11.25 2.2 11.25 2.75V4.75",
    ],
  },
};

/** A button showing only an icon. `label` names it for screen readers. @param {keyof typeof ICONS} name @param {string} label @param {Record<string, any>} props */
function iconButton(name, label, props) {
  const { size, stroke, paths } = ICONS[name];
  const svg = document.createElementNS(SVG, "svg");
  const attrs = { viewBox: `0 0 ${size} ${size}`, fill: "none", stroke: "currentColor", "stroke-width": stroke, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, String(value));
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return h("button", { class: `ghost icon ${name}`, type: "button", "aria-label": label, title: label, ...props }, svg);
}

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
  if (state.editing?.id === timer.id) return h("section", { class: "card timer" }, renderEdit(timer));
  const key = `stop:${timer.id}`;
  const name = timer.task ? `${timer.task} timer` : "timer";
  return h(
    "section",
    { class: "card timer" },
    h("div", { class: "row" }, h("div", { class: "grow task" }, timer.task || "No description"), h("div", { class: "clock", "data-started": timer.startedAt }, elapsed(timer.startedAt))),
    state.confirming === timer.id
      ? renderConfirm(timer, "Delete this timer? Its time won't be saved.", "Keep running", "task")
      : h(
          "div",
          { class: "row" },
          h("div", { class: "grow" }, projectLine(timer.projectId)),
          iconButton("edit", `Edit ${name}`, { id: `edit-${timer.id}`, onclick: () => openEdit(timer) }),
          iconButton("delete", `Delete ${name}`, { id: `delete-${timer.id}`, onclick: () => openConfirm(timer.id) }),
          h("button", { class: "danger", disabled: state.busy.has(key), onclick: () => void act(key, () => api(`/time-entries/${timer.id}/stop`, { method: "POST" })) }, state.busy.has(key) ? "Stopping…" : "Stop"),
        ),
  );
}

// ---------- editing and deleting ----------

/** Where focus goes after the next render, when the element that has it is going away. @type {string | null} */
let focusNext = null;

/** @param {any} entry */
function openEdit(entry) {
  state.editing = {
    id: entry.id,
    running: !entry.endedAt,
    day: dayOf(new Date(entry.startedAt)),
    task: entry.task ?? "",
    projectId: entry.projectId,
    start: clockTime(entry.startedAt),
    end: entry.endedAt ? clockTime(entry.endedAt) : "",
  };
  delete boxes["edit-task"];
  delete boxes["edit-project"];
  focusNext = "edit-task";
  set({ confirming: null, error: null });
}

/** @param {string} id */
function closeEdit(id) {
  focusNext = `edit-${id}`;
  set({ editing: null, error: null });
}

/** The draft's start and end. An end at or before the start is on the next day, as in the Cyclops web app. @param {Draft} draft */
function range(draft) {
  const start = draft.start ? atTime(draft.day, draft.start) : null;
  const end = draft.start && draft.end ? atTime(draft.end <= draft.start ? addDays(draft.day, 1) : draft.day, draft.end) : null;
  return { start, end };
}

/** What the draft changes, as PATCH /time-entries/:id takes it. @param {any} entry @param {Draft} draft */
function changes(entry, draft) {
  const { start, end } = range(draft);
  if (!start || (!draft.running && !end)) throw new Error(draft.running ? "Enter a start time." : "Enter a start and an end time.");
  if (draft.running && start.getTime() > Date.now()) throw new Error("The start time can't be in the future while the timer runs.");
  if (!draft.running && draft.end === draft.start) throw new Error("The end time must differ from the start.");
  // The form shows minutes, so a time left alone matches its entry to the minute and isn't sent.
  const minute = (/** @type {Date | string} */ t) => Math.floor(new Date(t).getTime() / 60_000);
  /** @type {Record<string, string>} */
  const body = {};
  // An empty task clears it, as in the Cyclops web app.
  if (draft.task.trim() !== (entry.task ?? "")) body.task = draft.task.trim();
  if (draft.projectId !== entry.projectId) body.projectId = draft.projectId;
  if (minute(start) !== minute(entry.startedAt)) body.startedAt = start.toISOString();
  if (end && minute(end) !== minute(entry.endedAt)) body.endedAt = end.toISOString();
  return body;
}

/** @param {any} entry */
function renderEdit(entry) {
  const draft = /** @type {Draft} */ (state.editing);
  const key = `save:${entry.id}`;
  const busy = state.busy.has(key);
  const hint = h("span", { class: "grow muted" });
  const showDuration = () => {
    const { start, end } = range(draft);
    hint.textContent = start && end ? duration((end.getTime() - start.getTime()) / 60_000) : "";
  };
  const time = (/** @type {"start" | "end"} */ field, /** @type {string} */ label) =>
    h(
      "label",
      { class: "time" },
      label,
      h("input", {
        type: "time",
        id: `edit-${field}`,
        value: draft[field],
        oninput: (/** @type {Event} */ e) => {
          draft[field] = /** @type {HTMLInputElement} */ (e.target).value;
          showDuration();
        },
      }),
    );
  showDuration();
  return h(
    "form",
    {
      class: "editor stack",
      "aria-label": `Edit ${entry.task || (draft.running ? "timer" : "entry")}`,
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        closeEdit(entry.id);
      },
      onsubmit: (/** @type {SubmitEvent} */ e) => {
        e.preventDefault();
        if (busy) return;
        let body;
        try {
          body = changes(entry, draft);
        } catch (error) {
          return set({ error: error instanceof Error ? error.message : String(error) });
        }
        if (Object.keys(body).length === 0) return closeEdit(entry.id);
        void act(key, async () => {
          await api(`/time-entries/${entry.id}`, { method: "PATCH", body });
          if (state.editing !== draft) return;
          state.editing = null;
          focusNext = `edit-${entry.id}`;
        });
      },
    },
    taskBox({ id: "edit-task", label: "Task", placeholder: "What have you worked on?", text: () => draft.task, onChange: (task) => (draft.task = task), projectId: () => draft.projectId }),
    projectBox("edit-project", () => draft.projectId, (id) => (draft.projectId = id)),
    h("div", { class: "row" }, time("start", draft.running ? "Started" : "Start"), draft.running ? null : time("end", "End"), hint),
    h(
      "div",
      { class: "row buttons" },
      h("button", { class: "ghost", type: "button", onclick: () => closeEdit(entry.id) }, "Cancel"),
      // aria-disabled rather than disabled, so focus stays on the button while it saves.
      h("button", { class: "primary", type: "submit", id: "edit-save", "aria-disabled": busy ? "true" : null }, busy ? "Saving…" : "Save"),
    ),
  );
}

/** @param {string} id */
function openConfirm(id) {
  focusNext = `keep-${id}`;
  set({ confirming: id, editing: null, error: null });
}

/** @param {string} id */
function closeConfirm(id) {
  focusNext = `delete-${id}`;
  set({ confirming: null, error: null });
}

/** Asks before deleting, in place of the row's buttons. `after` is the id that gets focus once it's gone. @param {any} entry @param {string} question @param {string} keep @param {string} after */
function renderConfirm(entry, question, keep, after) {
  const key = `delete:${entry.id}`;
  const busy = state.busy.has(key);
  return h(
    "div",
    {
      class: "confirm row",
      role: "group",
      "aria-labelledby": `question-${entry.id}`,
      onkeydown: (/** @type {KeyboardEvent} */ e) => e.key === "Escape" && closeConfirm(entry.id),
    },
    h("span", { class: "grow", id: `question-${entry.id}` }, question),
    h(
      "button",
      {
        class: "danger",
        type: "button",
        id: `confirm-${entry.id}`,
        "aria-disabled": busy ? "true" : null,
        onclick: () => {
          if (busy) return;
          void act(key, async () => {
            await api(`/time-entries/${entry.id}`, { method: "DELETE" });
            if (state.confirming === entry.id) state.confirming = null;
            focusNext = after;
          });
        },
      },
      busy ? "Deleting…" : "Delete",
    ),
    h("button", { class: "ghost", type: "button", id: `keep-${entry.id}`, onclick: () => closeConfirm(entry.id) }, keep),
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
      // An open list takes the Escape, so a form around the field closes on the next one.
      if (e.key === "Escape" && ui.open) e.preventDefault();
      close();
    }
  });
  liveBoxes.set(o.id, { root, close });
  draw();
  return root;
}

const projectLabel = (p) => `${p.name} · ${p.clientName}`;

/** A task field suggesting recent tasks, the project's own first. @param {{ id: string, label: string, placeholder: string, text: () => string, onChange: (task: string) => void, projectId: () => string }} o */
const taskBox = (o) =>
  combobox({
    id: o.id,
    label: o.label,
    placeholder: o.placeholder,
    freeText: true,
    text: o.text,
    onInput: o.onChange,
    options: (query) => suggest(query, o.projectId()).map((s) => ({ key: s.task, label: s.task })),
    onPick: o.onChange,
    empty: (query) => (query.trim() ? "No matching tasks." : "No recent tasks yet."),
  });

/** A field that finds a project by its name or client. @param {string} id @param {() => string} value @param {(id: string) => void} onChange */
const projectBox = (id, value, onChange) =>
  combobox({
    id,
    label: "Project",
    placeholder: "Find a project or client",
    freeText: false,
    text: () => {
      const p = state.projects.find((x) => x.id === value());
      return p ? projectLabel(p) : "";
    },
    options: (query) => {
      const q = query.trim().toLowerCase();
      return state.projects
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q))
        .map((p) => ({ key: p.id, label: p.name, detail: p.clientName }));
    },
    onPick: onChange,
    empty: () => "No matching projects.",
  });

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
    taskBox({
      id: "task",
      label: "What are you working on?",
      placeholder: "What are you working on?",
      text: () => state.task,
      onChange: (task) => (state.task = task),
      projectId: () => state.projectId,
    }),
    h(
      "div",
      { class: "row" },
      projectBox("project", () => state.projectId, (id) => (state.projectId = id)),
      h("button", { class: "primary", type: "submit", disabled: busy || !state.projectId }, busy ? "Starting…" : "Start"),
    ),
  );
}

/** Minutes logged on a day, in the week's entries. A running timer counts towards today. @param {any[]} entries @param {string} day */
const minutesOn = (entries, day) => entries.reduce((n, e) => n + (e.endedAt && e.entryDate === day ? (e.durationMinutes ?? 0) : 0), 0) + (day === today() ? runningMinutes() : 0);

/** The week's range with arrows, and a button for each of its days with its total. */
function renderWeek() {
  const monday = shownWeek();
  const selected = selectedDay();
  const now = today();
  const current = monday === weekStart();
  const entries = state.weeks.get(monday);
  return h(
    "section",
    { class: "stack", "aria-label": "Week" },
    h(
      "div",
      { class: "row week" },
      iconButton("previous", "Previous week", { id: "week-previous", onclick: () => show(addDays(selected, -7)) }),
      h("h2", { class: "range" }, weekRange(monday)),
      // aria-disabled rather than disabled, as in the Cyclops web app, so focus stays on the button that got you here.
      iconButton("next", "Next week", { id: "week-next", "aria-disabled": current ? "true" : null, onclick: () => current || show(addDays(selected, 7)) }),
      h("span", { class: "grow" }),
      h("button", { class: "ghost", type: "button", id: "week-all", "aria-pressed": String(state.wholeWeek), onclick: () => ((state.wholeWeek = !state.wholeWeek), show(state.day)) }, "Week"),
      h(
        "button",
        {
          class: "ghost",
          type: "button",
          id: "week-today",
          "aria-disabled": selected === now && !state.wholeWeek ? "true" : null,
          onclick: () => (selected === now && !state.wholeWeek) || ((state.wholeWeek = false), show(null)),
        },
        "Today",
      ),
    ),
    h(
      "div",
      { class: "days" },
      ...Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i);
        const future = day > now;
        const minutes = entries && !future ? minutesOn(entries, day) : null;
        // h:mm, like the title bar, so ten hours and more fit a 360 px sidebar.
        const total = minutes === null ? "" : minutes ? `${Math.floor(Math.round(minutes) / 60)}:${String(Math.round(minutes) % 60).padStart(2, "0")}` : "–";
        return h(
          "button",
          {
            class: "day",
            type: "button",
            id: `day-${day}`,
            "aria-pressed": String(day === selected && !state.wholeWeek),
            "aria-current": day === now ? "date" : null,
            "aria-label": `${dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}${minutes === null ? "" : `, ${minutes ? duration(minutes) : "nothing logged"}`}`,
            disabled: future,
            onclick: () => (day === selected && !state.wholeWeek) || ((state.wholeWeek = false), show(day)),
          },
          h("span", { class: "name" }, dayLabel(day, { weekday: "short", day: "numeric" })),
          h("span", { class: minutes ? "total" : "total muted" }, total),
        );
      }),
    ),
  );
}

/** The shown week's days that have entries, newest first, or the selected day when there are none. @param {any[]} week */
function weekDays(week) {
  const days = [...new Set(week.filter((e) => e.endedAt).map((e) => e.entryDate))].sort().reverse();
  return days.length ? days : [selectedDay()];
}

/** A day's heading and total over its entries. @param {any[]} week @param {string} day @param {any[]} done */
function daySection(week, day, done) {
  const listed = done.filter((e) => e.entryDate === day);
  return [
    h("h3", { class: "section-title" }, h("span", {}, dayName(day)), h("span", {}, duration(minutesOn(week, day)))),
    listed.length === 0
      ? h("p", { class: "muted" }, day === today() ? "Nothing logged today yet." : `Nothing logged on ${dayName(day)}.`)
      : h(
          "ul",
          { class: "entries" },
          ...listed.map((e, i) => {
            if (state.editing?.id === e.id) return h("li", { class: "entry editing" }, renderEdit(e));
            // Once this row is gone, focus moves to the same button on the next one.
            const neighbour = listed[i + 1] ?? listed[i - 1];
            if (state.confirming === e.id) return h("li", { class: "entry" }, renderConfirm(e, "Delete this entry?", "Cancel", neighbour ? `delete-${neighbour.id}` : `day-${day}`));
            const key = `resume:${e.id}`;
            const name = e.task || "entry";
            return h(
              "li",
              { class: "entry" },
              h("div", { class: "what" }, h("div", { class: "task" }, e.task || "No description"), projectLine(e.projectId)),
              h("div", { class: "when" }, h("strong", {}, duration(e.durationMinutes ?? 0)), `${clockTime(e.startedAt)}–${clockTime(e.endedAt)}`),
              h(
                "div",
                { class: "actions" },
                iconButton("resume", `Resume ${name}`, {
                  disabled: state.busy.has(key),
                  onclick: () =>
                    void act(key, () => api("/time-entries/timer", { method: "POST", body: e.task ? { projectId: e.projectId, task: e.task } : { projectId: e.projectId } })),
                }),
                iconButton("edit", `Edit ${name}`, { id: `edit-${e.id}`, onclick: () => openEdit(e) }),
                iconButton("delete", `Delete ${name}`, { id: `delete-${e.id}`, onclick: () => openConfirm(e.id) }),
              ),
            );
          }),
        ),
  ];
}

function renderEntries() {
  const day = selectedDay();
  const monday = shownWeek();
  const week = state.weeks.get(monday);
  const current = monday === weekStart();
  if (!week) {
    const failed = state.weekError?.week === monday ? state.weekError : null;
    return failed
      ? h("div", { class: "row" }, h("p", { class: "grow error", role: "alert" }, `Couldn't load this week. ${failed.message}`), h("button", { class: "ghost", type: "button", id: "week-retry", onclick: () => show(state.day) }, "Try again"))
      : h("div", { class: "row muted" }, h("span", { class: "spinner", "aria-hidden": true }), "Loading the week…");
  }
  const done = week.filter((e) => e.endedAt);
  const sum = (list) => list.reduce((n, e) => n + (e.durationMinutes ?? 0), 0);
  return h(
    "section",
    { class: "stack" },
    ...(state.wholeWeek ? weekDays(week) : [day]).flatMap((d) => daySection(week, d, done)),
    h("div", { class: "section-title" }, h("span", {}, current ? "This week" : weekRange(monday)), h("span", { id: "week-total" }, duration(sum(done) + (current ? runningMinutes() : 0)))),
  );
}

function render() {
  // Rendering replaces the page, so keep the caret in the field you're typing in.
  const focused = focusNext ?? document.activeElement?.id;
  const caret = !focusNext && document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionStart : null;
  focusNext = null;
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
              void wings.broadcast({ type: "timers-changed" });
              set({ phase: "connect", me: null, timers: [], weeks: new Map(), day: null, weekError: null });
            },
          },
          "Sign out",
        ),
      ),
      ...state.timers.map(renderTimer),
      renderStart(),
      renderWeek(),
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
// Not while an entry is being edited: a render moves the caret of a time field back to its hours.
setInterval(() => {
  if (state.phase === "ready" && state.busy.size === 0 && !state.editing) void refresh().then(render, () => {});
}, 60_000);

// Claude started or stopped a timer, or changed or deleted an entry, through the plugin's tools. The entry may be
// in any week, so earlier weeks load again when you next go to them.
wings.onBroadcast((message) => {
  if (/** @type {any} */ (message)?.type !== "timers-changed" || state.phase !== "ready") return;
  for (const monday of state.weeks.keys()) if (monday !== weekStart() && monday !== shownWeek()) state.weeks.delete(monday);
  void refresh(true).then(render, () => {});
});

render();
void load();
