//! The main script, a port of `src/main.ts`, `src/main/` and `src/tools.ts`: it keeps the running timer on the clock
//! button, and runs the tools Claude calls. The pages and this script tell each other about changes over the channel,
//! so a timer started in one shows in the other at once. Changes made elsewhere show on the next 30 s poll while Wings
//! is in front, or at once when it comes back.

use crate::{
    Entry, Failure, Project, api,
    dates::{self, clock_time, duration, today},
    entries,
};
use serde_json::{Map, Value, json};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    future::Future,
    pin::Pin,
};
use wings_plugin::{host, messages, poll, task, tools};

thread_local! {
    /// Projects by id, loaded when a timer's project isn't known yet.
    static PROJECTS: RefCell<Option<HashMap<String, Project>>> = const { RefCell::new(None) };
    /// Timers' projects the last /projects didn't list, like an archived one, so they aren't asked for every 30 s.
    static MISSING: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
}

type Answer = Pin<Box<dyn Future<Output = Result<Value, String>>>>;

/// A request, with the messages the title bar button and Claude's tools show.
fn request(path: String, method: &'static str, body: Option<Value>) -> Answer {
    Box::pin(async move {
        if !cfg!(feature = "fake") && !host::secret_has("token").await? {
            return Err("Cyclops isn't connected. Open the Cyclops sidebar in Wings and connect it.".into());
        }
        api(path, method, body).await.map_err(|failure| match failure {
            Failure::SignedOut => "Cyclops didn't accept the saved token. Connect again in the Cyclops sidebar.".into(),
            Failure::Other(message) => message,
        })
    })
}

fn get(path: impl Into<String>) -> Answer {
    request(path.into(), "GET", None)
}

async fn projects() -> Result<Vec<Project>, String> {
    Ok(serde_json::from_value(get("/projects").await?).unwrap_or_default())
}

fn by_id(list: Vec<Project>) -> HashMap<String, Project> {
    list.into_iter().map(|project| (project.id.clone(), project)).collect()
}

fn since(timer: &Entry) -> f64 {
    (host::now() - dates::parse(&timer.started_at)) / 60_000.0
}

async fn label() -> Result<(), String> {
    if !cfg!(feature = "fake") && !host::secret_has("token").await? {
        // Signed out: the next sign-in may be another account.
        PROJECTS.with(|projects| *projects.borrow_mut() = None);
        MISSING.with(|missing| missing.borrow_mut().clear());
        host::set_sidebar_label("tracker", None, &[]);
        return Ok(());
    }
    let timers = entries(get("/time-entries/timers").await?);
    let Some(first) = timers.iter().min_by(|a, b| dates::parse(&a.started_at).total_cmp(&dates::parse(&b.started_at))) else {
        host::set_sidebar_label("tracker", None, &[]);
        return Ok(());
    };
    let known = PROJECTS.with(|projects| {
        projects.borrow().as_ref().is_some_and(|projects| {
            timers.iter().all(|t| projects.contains_key(&t.project_id) || MISSING.with(|missing| missing.borrow().contains(&t.project_id)))
        })
    });
    let mut calls = vec![get(format!("/time-entries?from={0}&to={0}", today()))];
    if !known {
        calls.push(get("/projects"));
    }
    let mut answers = task::join_all(calls).await.into_iter();
    let logged: f64 = entries(answers.next().unwrap()?).iter().filter(|e| e.ended_at.is_some()).map(|e| e.duration_minutes.unwrap_or(0.0)).sum();
    if let Some(list) = answers.next() {
        let list = by_id(serde_json::from_value(list?).unwrap_or_default());
        MISSING.with(|missing| *missing.borrow_mut() = timers.iter().map(|t| t.project_id.clone()).filter(|id| !list.contains_key(id)).collect());
        PROJECTS.with(|projects| *projects.borrow_mut() = Some(list));
    }
    let project = PROJECTS.with(|projects| projects.borrow().as_ref().and_then(|projects| projects.get(&first.project_id).cloned()));
    let running: f64 = timers.iter().map(since).sum();
    let minutes = since(first).floor() as i64;
    let count = format!("{} timers", timers.len());
    let task = first.task.clone().filter(|task| !task.is_empty()).unwrap_or_else(|| "No description".into());
    let project = project.map_or_else(|| "Unknown project".to_owned(), |p| format!("{} · {}", p.name, p.client_name));
    let (started, total) = (clock_time(&first.started_at), duration(logged + running));
    let mut rows = Vec::new();
    if timers.len() > 1 {
        rows.push(("Running", count.as_str()));
    }
    rows.extend([("Task", task.as_str()), ("Project", project.as_str()), ("Started", started.as_str()), ("Today", total.as_str())]);
    host::set_sidebar_label("tracker", Some(&format!("{}:{:02}", minutes / 60, minutes % 60)), &rows);
    Ok(())
}

/// The running timer on the clock button, with details when you point at it. A failure leaves the label as it is.
fn refresh_label() {
    task::spawn(async {
        let _ = label().await;
    });
}

/// A tool changed a timer or entry: update the button and tell the sidebar and popover.
fn changed() {
    refresh_label();
    messages::tell("timers-changed", &Value::Null);
}

// ---------- the tools Claude gets, as `contributes.mcpTools` of the manifest has them ----------

fn object(properties: Value, required: &[&str]) -> Value {
    let mut schema = json!({ "type": "object", "properties": properties, "additionalProperties": false });
    if !required.is_empty() {
        schema["required"] = json!(required);
    }
    schema
}

fn or_null(text: Option<&str>) -> Value {
    text.filter(|text| !text.is_empty()).map_or(Value::Null, Value::from)
}

async fn timers() -> Result<Vec<Value>, String> {
    let mut answers = task::join_all(vec![get("/time-entries/timers"), get("/projects")]).await.into_iter();
    let (running, list) = (entries(answers.next().unwrap()?), by_id(serde_json::from_value(answers.next().unwrap()?).unwrap_or_default()));
    Ok(running
        .iter()
        .map(|t| {
            let project = list.get(&t.project_id);
            json!({
                "id": t.id,
                "project": project.map_or(&t.project_id, |p| &p.name),
                "client": project.map(|p| &p.client_name),
                "task": or_null(t.task.as_deref()),
                "startedAt": t.started_at,
            })
        })
        .collect())
}

fn entry_info(e: &Entry, list: &HashMap<String, Project>) -> Value {
    let project = list.get(&e.project_id);
    json!({
        "id": e.id,
        "date": e.entry_date,
        "task": or_null(e.task.as_deref()),
        "project": project.map_or(&e.project_id, |p| &p.name),
        "client": project.map(|p| &p.client_name),
        "projectId": e.project_id,
        "startedAt": e.started_at,
        "endedAt": e.ended_at,
        "minutes": e.duration_minutes,
    })
}

/// `encodeURIComponent`.
fn encoded(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => char::from(byte).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// An ISO 8601 time with `Z` or an offset, which the tool's schema has checked, as `Date.prototype.toISOString`
/// writes that instant.
fn utc(time: &str) -> String {
    let time = time.to_uppercase();
    let zone = time[11..].find(['Z', '+', '-']).map_or(time.len(), |at| at + 11);
    let (clock, zone) = time.split_at(zone);
    let offset = match zone.split_once(':') {
        Some((hours, minutes)) => {
            let ahead = hours[1..].parse::<f64>().unwrap_or(0.0) * 60.0 + minutes.parse::<f64>().unwrap_or(0.0);
            if hours.starts_with('-') { -ahead } else { ahead }
        }
        None => 0.0,
    };
    dates::iso(dates::parse(clock) - offset * 60_000.0)
}

fn register_tools() {
    let uuid = |about: &str| json!({ "type": "string", "format": "uuid", "description": about });

    tools::register("list_projects", object(json!({}), &[]), |_, _| async {
        Ok(projects().await?.iter().map(|p| json!({ "id": p.id, "name": p.name, "client": p.client_name })).collect())
    });

    tools::register("running_timers", object(json!({}), &[]), |_, _| async {
        let running = timers().await?;
        Ok(if running.is_empty() { "No timer is running.".into() } else { running.into() })
    });

    tools::register(
        "start_timer",
        object(json!({ "projectId": uuid("The project to track time on"), "task": { "type": "string", "maxLength": 2000 } }), &["projectId"]),
        |input, _| async move {
            let task = input["task"].as_str().unwrap_or_default().trim().to_owned();
            let mut body = json!({ "projectId": input["projectId"] });
            if !task.is_empty() {
                body["task"] = task.clone().into();
            }
            let timer = request("/time-entries/timer".into(), "POST", Some(body)).await?;
            changed();
            Ok(json!({ "started": true, "timerId": timer["id"].as_str(), "projectId": input["projectId"], "task": or_null(Some(&task)) }))
        },
    );

    tools::register("stop_timer", object(json!({ "timerId": { "type": "string" } }), &[]), |input, _| async move {
        let id = match input["timerId"].as_str() {
            Some(id) => id.to_owned(),
            None => {
                let running = timers().await?;
                match &running[..] {
                    [] => return Ok("No timer is running.".into()),
                    [one] => one["id"].as_str().unwrap_or_default().to_owned(),
                    many => return Err(format!("{} timers are running. Pass timerId, from running_timers.", many.len())),
                }
            }
        };
        request(format!("/time-entries/{}/stop", encoded(&id)), "POST", None).await?;
        changed();
        Ok(json!({ "stopped": true, "timerId": id }))
    });

    let day = |about: &str| json!({ "type": "string", "format": "date", "description": about });
    tools::register("list_entries", object(json!({ "from": day("First day"), "to": day("Last day, included") }), &[]), |input, _| async move {
        let (from, to) = (input["from"].as_str(), input["to"].as_str());
        let first = from.or(to).map_or_else(today, str::to_owned);
        let last = to.map_or_else(|| first.clone().max(today()), str::to_owned);
        if first > last {
            return Err("from must be on or before to.".into());
        }
        let mut answers = task::join_all(vec![get(format!("/time-entries?from={first}&to={last}")), get("/projects")]).await.into_iter();
        let (list, all) = (entries(answers.next().unwrap()?), by_id(serde_json::from_value(answers.next().unwrap()?).unwrap_or_default()));
        Ok(if list.is_empty() { format!("No entries from {first} to {last}.").into() } else { list.iter().map(|e| entry_info(e, &all)).collect() })
    });

    let instant = || json!({ "type": "string", "format": "date-time" });
    tools::register(
        "update_entry",
        object(
            json!({
                "entryId": uuid("The entry to change"),
                "task": { "type": "string", "maxLength": 2000 },
                "projectId": uuid("Move the entry to this project, from list_projects"),
                "startedAt": instant(),
                "endedAt": instant(),
            }),
            &["entryId"],
        ),
        |input, _| async move {
            let mut body = Map::new();
            // An empty task clears it.
            if let Some(task) = input["task"].as_str() {
                body.insert("task".into(), task.trim().into());
            }
            if let Some(project) = input["projectId"].as_str() {
                body.insert("projectId".into(), project.into());
            }
            for name in ["startedAt", "endedAt"] {
                if let Some(time) = input[name].as_str() {
                    body.insert(name.into(), utc(time).into());
                }
            }
            if body.is_empty() {
                return Err("Pass at least one of task, projectId, startedAt and endedAt.".into());
            }
            let path = format!("/time-entries/{}", input["entryId"].as_str().unwrap_or_default());
            let mut answers = task::join_all(vec![request(path, "PATCH", Some(Value::Object(body))), get("/projects")]).await.into_iter();
            let (entry, all) = (answers.next().unwrap()?, by_id(serde_json::from_value(answers.next().unwrap()?).unwrap_or_default()));
            changed();
            let entry: Entry = serde_json::from_value(entry).map_err(|_| "Cyclops answered with something that isn't an entry.".to_owned())?;
            Ok(json!({ "updated": true, "entry": entry_info(&entry, &all) }))
        },
    );

    tools::register("delete_entry", object(json!({ "entryId": uuid("The entry to delete") }), &["entryId"]), |input, _| async move {
        let id = input["entryId"].as_str().unwrap_or_default().to_owned();
        request(format!("/time-entries/{id}"), "DELETE", None).await?;
        changed();
        Ok(json!({ "deleted": true, "entryId": id }))
    });
}

#[unsafe(no_mangle)]
pub fn start() {
    // A page started, stopped or resumed a timer, or connected or signed out.
    messages::on("timers-changed", |_| refresh_label());
    refresh_label();
    // Two requests a minute stay far below Cyclops's limit of 100 per token, and none go out while Wings is in the
    // background: the label is checked again the moment you come back.
    poll::while_focused(30_000, false, refresh_label);
    register_tools();
}
