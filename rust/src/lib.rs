//! Cyclops for the native Wings app. One crate builds its three frames, each a
//! module of its own: the sidebar (no feature), the popover (`--features popover`) and the main script
//! (`--features main`, `main_frame.rs`), which `build.sh` writes to `dist/native/`. They tell each other about changes
//! over the SDK's channel, and reach Cyclops through `wings.fetch`, which adds the token in
//! Wings, so no frame ever holds it.

// The main script draws nothing, so the pages' state and views are unused in its build, and left out of its module.
#![cfg_attr(feature = "main", allow(dead_code, unused_imports))]

mod dates;
#[cfg(feature = "fake")]
mod fake;
#[cfg(feature = "main")]
mod main_frame;
mod view;

use dates::{add_days, at_time, clock_time, day_of, monday_of, today, week_start};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    future::Future,
};
use wings_plugin::{host, messages, poll, task};

const API: &str = "https://cyclops-api.prototyp.digital/api";
pub const WEB: &str = "https://cyclops.prototyp.digital";
const SIGNED_OUT: &str = "Cyclops didn't accept the saved token. Connect again.";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub client_name: String,
}

/// A time entry, or a running timer, which has no end.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub task: Option<String>,
    pub started_at: String,
    #[serde(default)]
    pub ended_at: Option<String>,
    /// YYYY-MM-DD.
    pub entry_date: String,
    #[serde(default)]
    pub duration_minutes: Option<f64>,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum Phase {
    #[default]
    Loading,
    Connect,
    Ready,
}

/// The popover's form: a timer, or with `manual` an entry today from `start` to `end` (HH:MM).
#[derive(Default)]
pub struct Adding {
    pub manual: bool,
    pub start: String,
    pub end: String,
}

pub struct Suggestion {
    pub task: String,
    pub project_ids: Vec<String>,
    pub last_used_at: f64,
    /// Its place among the tasks as they were first seen, which orders two used at the same instant.
    seen: usize,
}

/// An entry being edited, with its times as HH:MM on `day`.
#[derive(Clone)]
pub struct Draft {
    pub id: String,
    pub running: bool,
    pub day: String,
    pub task: String,
    pub project_id: String,
    pub start: String,
    pub end: String,
}

/// `weeks` holds each week's entries by its Monday, once loaded. `day` is the day being looked at, or none to follow
/// today. `whole_week` lists every day of that day's week instead.
#[derive(Default)]
pub struct State {
    pub phase: Phase,
    pub name: String,
    pub projects: Vec<Project>,
    pub timers: Vec<Entry>,
    pub weeks: HashMap<String, Vec<Entry>>,
    pub day: Option<String>,
    pub whole_week: bool,
    pub week_error: Option<(String, String)>,
    pub history: HashMap<String, Suggestion>,
    pub error: Option<String>,
    pub busy: HashSet<String>,
    pub task: String,
    pub project_id: String,
    pub editing: Option<Draft>,
    pub confirming: Option<String>,
    pub adding: Adding,
    /// The token being typed in the connect form.
    pub token: String,
    /// What is typed in a project picker since it took the keyboard, by the picker's name.
    pub searches: HashMap<&'static str, String>,
    /// The Monday being fetched. One week loads at a time.
    loading_week: Option<String>,
    ticking: bool,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

/// Reads or changes the state. Never across a wait, and never from inside another `with`.
pub fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|state| f(&mut state.borrow_mut()))
}

pub enum Failure {
    SignedOut,
    Other(String),
}

async fn api(path: String, method: &'static str, body: Option<Value>) -> Result<Value, Failure> {
    let mut retried = false;
    loop {
        #[cfg(not(feature = "fake"))]
        let fetch = host::fetch;
        #[cfg(feature = "fake")]
        let fetch = fake::fetch;
        let answer = fetch(&format!("{API}{path}"), method, body.as_ref(), Some("token")).await.map_err(Failure::Other)?;
        if answer.status == 401 {
            return Err(Failure::SignedOut);
        }
        let data: Value = serde_json::from_str(&answer.body).unwrap_or(Value::Null);
        let message = match &data["message"] {
            Value::String(text) => text.clone(),
            Value::Array(list) => list.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "),
            _ => String::new(),
        };
        // Cyclops says a 409 ending in "try again" is a lost race worth one plain retry.
        if answer.status == 409 && message.to_lowercase().ends_with("try again") && !retried {
            retried = true;
            continue;
        }
        if answer.status == 429 {
            return Err(Failure::Other("Cyclops is limiting requests from this token. Try again in a minute.".into()));
        }
        if answer.status >= 400 {
            return Err(Failure::Other(if message.is_empty() { format!("Cyclops answered {}", answer.status) } else { message }));
        }
        return Ok(data);
    }
}

fn get(path: String) -> std::pin::Pin<Box<dyn Future<Output = Result<Value, Failure>>>> {
    Box::pin(api(path, "GET", None))
}

/// The entries of an answer. One that isn't an entry is left out.
fn entries(answer: Value) -> Vec<Entry> {
    match answer {
        Value::Array(list) => list.into_iter().filter_map(|entry| serde_json::from_value(entry).ok()).collect(),
        _ => Vec::new(),
    }
}

fn signed_out(state: &mut State) {
    state.phase = Phase::Connect;
    state.error = Some(SIGNED_OUT.into());
}

/// The main script keeps the title bar button current, and the other page its entries.
fn tell_changed() {
    messages::tell("timers-changed", &Value::Null);
}

async fn load() {
    let result: Result<(), Failure> = async {
        if !cfg!(feature = "fake") && !host::secret_has("token").await.map_err(Failure::Other)? {
            with(|s| s.phase = Phase::Connect);
            return Ok(());
        }
        profile().await?;
        let (refreshed, history) = (Box::pin(refresh(false)), Box::pin(load_history()));
        for result in task::join_all::<Result<(), Failure>>(vec![refreshed, history]).await {
            result?;
        }
        with(|s| s.phase = Phase::Ready);
        Ok(())
    }
    .await;
    with(|s| match result {
        Ok(()) => {}
        Err(Failure::SignedOut) => signed_out(s),
        Err(Failure::Other(message)) => {
            if s.phase == Phase::Loading {
                s.phase = Phase::Connect;
            }
            s.error = Some(message);
        }
    });
}

/// Who the token is, and their projects.
async fn profile() -> Result<(), Failure> {
    let mut answers = task::join_all(vec![get("/auth/me".into()), get("/projects".into())]).await.into_iter();
    let (me, projects) = (answers.next().unwrap()?, answers.next().unwrap()?);
    with(|s| {
        s.name = me["name"].as_str().unwrap_or_default().to_owned();
        s.projects = serde_json::from_value(projects).unwrap_or_default();
    });
    Ok(())
}

/// Task suggestions come from the last 8 weeks, like the Cyclops web app.
async fn load_history() -> Result<(), Failure> {
    let recent = entries(get(format!("/time-entries?from={}", week_start(7))).await?);
    with(|s| remember(s, &recent));
    Ok(())
}

/// Adds entries' tasks to the suggestions: one per task ignoring case, with every project it was logged on.
fn remember(state: &mut State, list: &[Entry]) {
    for entry in list {
        let Some(task) = entry.task.as_deref().map(str::trim).filter(|task| !task.is_empty()) else {
            continue;
        };
        let used = dates::parse(&entry.started_at);
        let seen = state.history.len();
        let old = state.history.entry(task.to_lowercase()).or_insert_with(|| Suggestion { task: task.to_owned(), project_ids: Vec::new(), last_used_at: used, seen });
        if !old.project_ids.contains(&entry.project_id) {
            old.project_ids.push(entry.project_id.clone());
        }
        if used > old.last_used_at {
            old.task = task.to_owned();
            old.last_used_at = used;
        }
    }
}

/// Up to 8 tasks containing `query`, the selected project's first, then the most recent.
pub fn suggest(state: &State, query: &str, project_id: &str) -> Vec<String> {
    let query = query.trim().to_lowercase();
    let mut found: Vec<&Suggestion> = state.history.values().filter(|s| s.task.to_lowercase().contains(&query)).collect();
    let has = |s: &Suggestion| s.project_ids.iter().any(|id| id == project_id);
    found.sort_by(|a, b| {
        let by_project = if project_id.is_empty() { std::cmp::Ordering::Equal } else { has(b).cmp(&has(a)) };
        by_project.then(b.last_used_at.total_cmp(&a.last_used_at)).then(a.seen.cmp(&b.seen))
    });
    found.into_iter().take(8).map(|s| s.task.clone()).collect()
}

pub fn selected_day(state: &State) -> String {
    state.day.clone().unwrap_or_else(today)
}
pub fn shown_week(state: &State) -> String {
    monday_of(&selected_day(state))
}
fn week_path(monday: &str) -> String {
    format!("/time-entries?from={monday}&to={}", add_days(monday, 6))
}

/// Reloads the timers and this week, and with `shown` also the earlier week on screen.
async fn refresh(shown: bool) -> Result<(), Failure> {
    let current = week_start(0);
    // A week that isn't loaded yet is `load_week`'s to fetch.
    let other = with(|s| {
        let week = shown_week(s);
        (shown && week != current && s.weeks.contains_key(&week)).then_some(week)
    });
    let mut calls = vec![get("/time-entries/timers".into()), get(week_path(&current))];
    calls.extend(other.as_deref().map(|week| get(week_path(week))));
    let mut answers = task::join_all(calls).await.into_iter();
    let (timers, week) = (entries(answers.next().unwrap()?), entries(answers.next().unwrap()?));
    let older = match answers.next() {
        Some(answer) => Some(entries(answer?)),
        None => None,
    };
    with(|s| {
        remember(s, &timers);
        remember(s, &week);
        if s.project_id.is_empty() {
            s.project_id = timers.first().or(week.first()).map(|e| e.project_id.clone()).or(s.projects.first().map(|p| p.id.clone())).unwrap_or_default();
        }
        s.timers = timers;
        s.weeks.insert(current, week);
        if let (Some(monday), Some(older)) = (other, older) {
            remember(s, &older);
            s.weeks.insert(monday, older);
        }
    });
    tick();
    Ok(())
}

/// Running clocks show each second: the page is built again while a timer runs, and not otherwise.
fn tick() {
    if with(|s| s.timers.is_empty() || std::mem::replace(&mut s.ticking, true)) {
        return;
    }
    task::spawn(async {
        while with(|s| !s.timers.is_empty()) {
            host::sleep(1000).await;
        }
        with(|s| s.ticking = false);
    });
}

/// Fetches the week on screen unless it's loaded, or failed until you try again.
fn load_week() {
    let Some(monday) = with(|s| {
        let monday = shown_week(s);
        let skip = s.loading_week.is_some() || s.weeks.contains_key(&monday) || s.week_error.as_ref().is_some_and(|(week, _)| *week == monday);
        (!skip).then(|| {
            s.loading_week = Some(monday.clone());
            monday
        })
    }) else {
        return;
    };
    task::spawn(async move {
        let answer = get(week_path(&monday)).await;
        with(|s| {
            s.loading_week = None;
            match answer {
                Ok(answer) => {
                    let list = entries(answer);
                    remember(s, &list);
                    s.weeks.insert(monday, list);
                }
                Err(Failure::SignedOut) => signed_out(s),
                Err(Failure::Other(message)) => s.week_error = Some((monday, message)),
            }
        });
        // You may have moved to another week while this one loaded.
        if with(|s| s.phase == Phase::Ready) {
            load_week();
        }
    });
}

/// Shows a day, or today for none, and loads its week.
pub fn show(day: Option<String>) {
    with(|s| {
        s.day = day.filter(|day| *day < today());
        s.week_error = None;
        // An entry being edited or deleted goes off screen. A running timer's stays.
        if s.editing.as_ref().is_some_and(|draft| !draft.running) {
            s.editing = None;
        }
        if s.confirming.as_ref().is_some_and(|id| !s.timers.iter().any(|t| t.id == *id)) {
            s.confirming = None;
        }
    });
    load_week();
}

/// Runs an action with its button showing progress, then reloads.
fn act(key: impl Into<String>, action: impl Future<Output = Result<(), Failure>> + 'static) {
    let key = key.into();
    with(|s| {
        s.busy.insert(key.clone());
        s.error = None;
    });
    task::spawn(async move {
        let result = async {
            action.await?;
            tell_changed();
            refresh(true).await
        }
        .await;
        with(|s| {
            match result {
                Ok(()) => {}
                Err(Failure::SignedOut) => signed_out(s),
                Err(Failure::Other(message)) => s.error = Some(message),
            }
            s.busy.remove(&key);
        });
    });
}

/// An action that is one request to Cyclops.
fn request(key: impl Into<String>, path: String, method: &'static str, body: Option<Value>) {
    act(key, async move { api(path, method, body).await.map(drop) });
}

/// Reloads timers and entries, and has the main script reload the title bar button's label.
pub fn reload() {
    act("refresh", async { Ok(()) });
}

pub fn start_timer() {
    let Some(body) = with(|s| (!s.project_id.is_empty()).then(|| timer_body(&s.project_id, &s.task))) else {
        return;
    };
    act("start", async move {
        api("/time-entries/timer".into(), "POST", Some(body)).await?;
        with(|s| s.task.clear());
        Ok(())
    });
}

/// The popover's manual entry: today, from the form's start to its end.
pub fn add_entry() {
    let body = with(|s| {
        if s.project_id.is_empty() {
            return None;
        }
        if s.adding.start.is_empty() || s.adding.end.is_empty() {
            s.error = Some("Enter a start and an end time.".into());
            return None;
        }
        if s.adding.end <= s.adding.start {
            s.error = Some("The end time must be after the start.".into());
            return None;
        }
        let mut body = timer_body(&s.project_id, &s.task);
        body["startedAt"] = dates::iso(at_time(&today(), &s.adding.start)).into();
        body["endedAt"] = dates::iso(at_time(&today(), &s.adding.end)).into();
        Some(body)
    });
    let Some(body) = body else {
        return;
    };
    act("add", async move {
        api("/time-entries".into(), "POST", Some(body)).await?;
        with(|s| {
            s.task.clear();
            s.adding.start.clear();
            s.adding.end.clear();
        });
        Ok(())
    });
}

/// A timer's project and task, as Cyclops takes them. It refuses empty fields, so a blank task is left out.
fn timer_body(project_id: &str, task: &str) -> Value {
    let mut body = json!({ "projectId": project_id });
    if !task.trim().is_empty() {
        body["task"] = task.trim().into();
    }
    body
}

pub fn resume(entry: &Entry) {
    request(format!("resume:{}", entry.id), "/time-entries/timer".into(), "POST", Some(timer_body(&entry.project_id, entry.task.as_deref().unwrap_or_default())));
}

pub fn stop(id: &str) {
    request(format!("stop:{id}"), format!("/time-entries/{id}/stop"), "POST", None);
}

pub fn delete(id: String) {
    act(format!("delete:{id}"), async move {
        api(format!("/time-entries/{id}"), "DELETE", None).await?;
        with(|s| {
            if s.confirming.as_deref() == Some(&id) {
                s.confirming = None;
            }
        });
        Ok(())
    });
}

pub fn connect() {
    let token = with(|s| s.token.trim().to_owned());
    if token.is_empty() {
        return;
    }
    act("connect", async move {
        host::secret_set("token", &token).await.map_err(Failure::Other)?;
        let loaded = async {
            profile().await?;
            load_history().await
        }
        .await;
        if let Err(failure) = loaded {
            // The token stays in its field, to be corrected.
            let _ = host::secret_delete("token").await;
            return Err(match failure {
                Failure::SignedOut => Failure::Other("That token didn't work. Check it's a Cyclops API token starting with cyc_.".into()),
                other => other,
            });
        }
        with(|s| {
            s.phase = Phase::Ready;
            s.token.clear();
        });
        Ok(())
    });
}

/// Removes the token from this Mac. It stays valid until you revoke it in Cyclops Settings.
pub fn sign_out() {
    task::spawn(async {
        let _ = host::secret_delete("token").await;
        tell_changed();
        with(|s| {
            s.phase = Phase::Connect;
            s.name.clear();
            s.timers.clear();
            s.weeks.clear();
            s.day = None;
            s.week_error = None;
        });
    });
}

// ---------- editing and deleting ----------

pub fn open_edit(entry: &Entry) {
    let draft = Draft {
        id: entry.id.clone(),
        running: entry.ended_at.is_none(),
        day: day_of(dates::parse(&entry.started_at)),
        task: entry.task.clone().unwrap_or_default(),
        project_id: entry.project_id.clone(),
        start: clock_time(&entry.started_at),
        end: entry.ended_at.as_deref().map(clock_time).unwrap_or_default(),
    };
    with(|s| {
        s.editing = Some(draft);
        s.confirming = None;
        s.error = None;
    });
}

pub fn close_edit() {
    with(|s| {
        s.editing = None;
        s.error = None;
    });
}

/// The draft's start and end. An end at or before the start is on the next day, as in the Cyclops web app.
pub fn range(draft: &Draft) -> (Option<f64>, Option<f64>) {
    let start = (!draft.start.is_empty()).then(|| at_time(&draft.day, &draft.start));
    let end = (!draft.start.is_empty() && !draft.end.is_empty())
        .then(|| at_time(&if draft.end <= draft.start { add_days(&draft.day, 1) } else { draft.day.clone() }, &draft.end));
    (start, end)
}

/// What the draft changes, as PATCH /time-entries/:id takes it.
fn changes(entry: &Entry, draft: &Draft) -> Result<Map<String, Value>, String> {
    let (start, end) = range(draft);
    let Some(start) = start.filter(|_| draft.running || end.is_some()) else {
        return Err(if draft.running { "Enter a start time." } else { "Enter a start and an end time." }.into());
    };
    if draft.running && start > host::now() {
        return Err("The start time can't be in the future while the timer runs.".into());
    }
    if !draft.running && draft.end == draft.start {
        return Err("The end time must differ from the start.".into());
    }
    // The form shows minutes, so a time left alone matches its entry to the minute and isn't sent.
    let minute = |ms: f64| (ms / 60_000.0).floor();
    let mut body = Map::new();
    // An empty task clears it, as in the Cyclops web app.
    if draft.task.trim() != entry.task.as_deref().unwrap_or_default() {
        body.insert("task".into(), draft.task.trim().into());
    }
    if draft.project_id != entry.project_id {
        body.insert("projectId".into(), draft.project_id.clone().into());
    }
    if minute(start) != minute(dates::parse(&entry.started_at)) {
        body.insert("startedAt".into(), dates::iso(start).into());
    }
    if let (Some(end), Some(ended_at)) = (end.filter(|_| !draft.running), &entry.ended_at)
        && minute(end) != minute(dates::parse(ended_at))
    {
        body.insert("endedAt".into(), dates::iso(end).into());
    }
    Ok(body)
}

pub fn save(entry: &Entry) {
    let Some(draft) = with(|s| s.editing.clone()) else {
        return;
    };
    let body = match changes(entry, &draft) {
        Ok(body) => body,
        Err(message) => return with(|s| s.error = Some(message)),
    };
    if body.is_empty() {
        return close_edit();
    }
    let id = entry.id.clone();
    act(format!("save:{id}"), async move {
        api(format!("/time-entries/{id}"), "PATCH", Some(Value::Object(body))).await?;
        with(|s| {
            if s.editing.as_ref().is_some_and(|open| open.id == id) {
                s.editing = None;
            }
        });
        Ok(())
    });
}

pub fn open_confirm(id: String) {
    with(|s| {
        s.confirming = Some(id);
        s.editing = None;
        s.error = None;
    });
}

pub fn close_confirm() {
    with(|s| {
        s.confirming = None;
        s.error = None;
    });
}

/// Changes made in the Cyclops web app or on a phone only show when asked for. Not while an entry is being edited or
/// an action runs.
fn quiet() {
    let idle = with(|s| s.phase == Phase::Ready && s.busy.is_empty() && s.editing.is_none());
    if idle {
        task::spawn(async {
            let _ = refresh(true).await;
        });
    }
}

#[cfg(not(feature = "main"))]
#[unsafe(no_mangle)]
pub fn start() {
    wings_plugin::run(|| with(|state| if cfg!(feature = "popover") { view::popover(state) } else { view::page(state) }));
    // Claude, the other page or the main script started or stopped a timer, or changed or deleted an entry. The entry
    // may be in any week, so earlier weeks load again when you next go to them.
    messages::on("timers-changed", |_| {
        let ready = with(|s| {
            let (current, shown) = (week_start(0), shown_week(s));
            s.weeks.retain(|monday, _| *monday == current || *monday == shown);
            s.phase == Phase::Ready
        });
        if ready {
            task::spawn(async {
                let _ = refresh(true).await;
            });
        }
    });
    // Every minute while Wings is in front, and once when you come back to it after longer.
    poll::while_focused(60_000, false, quiet);
    task::spawn(load());
}
