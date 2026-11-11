//! Made-up Cyclops answers, for looking at the page with no account behind it: two running timers, a week of entries
//! and a few projects, which Stop, Start, Save and Delete change as Cyclops would.

use crate::dates::{day_of, iso, parse};
use serde_json::{Value, json};
use std::cell::RefCell;
use wings_plugin::host::{self, Response};

const MINUTE: f64 = 60_000.0;

struct Fake {
    timers: Vec<Value>,
    entries: Vec<Value>,
}

thread_local! {
    static FAKE: RefCell<Option<Fake>> = const { RefCell::new(None) };
}

fn made_up() -> Fake {
    let now = host::now();
    let timer = |id: &str, project: &str, task: &str, minutes: f64| {
        json!({ "id": id, "projectId": project, "task": task, "startedAt": iso(now - minutes * MINUTE), "endedAt": null, "entryDate": day_of(now) })
    };
    // Whole hours back from now, so the made-up day never runs past midnight oddly.
    let entry = |id: &str, project: &str, task: &str, days: f64, hours_ago: f64, minutes: f64| {
        let start = ((now - days * 24.0 * 60.0 * MINUTE - hours_ago * 60.0 * MINUTE) / MINUTE).floor() * MINUTE;
        json!({ "id": id, "projectId": project, "task": task, "startedAt": iso(start), "endedAt": iso(start + minutes * MINUTE), "entryDate": day_of(start), "durationMinutes": minutes })
    };
    Fake {
        timers: vec![timer("t1", "p1", "Timer one", 65.0), timer("t2", "p2", "Timer two", 20.0)],
        entries: vec![
            entry("e1", "p1", "Code review", 0.0, 3.0, 45.0),
            entry("e6", "p2", "Report table keeps the \"Unassigned\" group last when sorted ascending", 0.0, 5.0, 60.0),
            entry("e2", "p2", "Checkout redesign", 1.0, 3.0, 210.0),
        ],
    }
}

pub async fn fetch(url: &str, method: &str, body: Option<&Value>, _bearer: Option<&str>) -> Result<Response, String> {
    let path = url.trim_start_matches(crate::API);
    let answer = FAKE.with(|fake| {
        let mut fake = fake.borrow_mut();
        let fake = fake.get_or_insert_with(made_up);
        let one = path.strip_prefix("/time-entries/");
        match (method, one) {
            ("POST", Some("timer")) => {
                let mut timer = body.cloned().unwrap_or_default();
                timer["id"] = format!("t{}", host::now()).into();
                timer["startedAt"] = iso(host::now()).into();
                timer["endedAt"] = Value::Null;
                timer["entryDate"] = day_of(host::now()).into();
                fake.timers.push(timer);
                json!({})
            }
            ("POST", Some(stop)) if stop.ends_with("/stop") => {
                let id = stop.trim_end_matches("/stop");
                if let Some(at) = fake.timers.iter().position(|t| t["id"] == id) {
                    let mut entry = fake.timers.remove(at);
                    entry["endedAt"] = iso(host::now()).into();
                    entry["durationMinutes"] = ((host::now() - parse(entry["startedAt"].as_str().unwrap_or_default())) / MINUTE).round().into();
                    fake.entries.insert(0, entry);
                }
                json!({})
            }
            ("PATCH", Some(id)) => {
                for entry in fake.timers.iter_mut().chain(&mut fake.entries).filter(|e| e["id"] == id) {
                    for (key, value) in body.and_then(Value::as_object).into_iter().flatten() {
                        entry[key] = value.clone();
                    }
                }
                json!({})
            }
            ("DELETE", Some(id)) => {
                fake.timers.retain(|e| e["id"] != id);
                fake.entries.retain(|e| e["id"] != id);
                json!({})
            }
            _ if path.starts_with("/auth/me") => json!({ "name": "Ada Lovelace", "timezone": "Europe/Zagreb" }),
            _ if path.starts_with("/projects") => json!([
                { "id": "p1", "name": "Wings", "clientName": "Prototyp" },
                { "id": "p2", "name": "Website", "clientName": "Acme" },
                { "id": "p3", "name": "Storefront rebuild for the spring launch", "clientName": "Northwind Traders" },
            ]),
            _ if path.starts_with("/time-entries/timers") => Value::Array(fake.timers.clone()),
            _ => Value::Array(fake.entries.clone()),
        }
    });
    // An answer comes a turn later, as a real one does.
    host::sleep(0).await;
    Ok(Response { status: 200, body: answer.to_string() })
}
