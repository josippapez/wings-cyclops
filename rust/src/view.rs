//! The page, built from the state: what `src/ui/Sidebar.tsx` and the components under it draw in the native app.

use crate::{
    Draft, Entry, Phase, State, WEB, add_entry, close_confirm, close_edit, connect, dates, delete, open_confirm, open_edit, range, reload,
    resume, save, selected_day, show, shown_week, sign_out, start_timer, stop, suggest, with,
};
use dates::{Style, add_days, at_time, clock_time, day_label, day_name, duration, elapsed, minutes_on, running_minutes, today, week_range, week_start};
use wings_plugin::{
    host,
    ui::{Choice, Combobox, Node, button, card, chips, combobox, dot, field_inline, heading, icon, list, list_item, muted, row, spinner, stack, text, text_input, title},
};

// The Cyclops web app's row icons, and arrows for the weeks: a view box's size, a stroke width and paths.
const RESUME: (u8, f64, &[&str]) = (12, 1.0, &["M9.79363 5.14742L3.77252 1.45752C3.10619 1.04918 2.25 1.52866 2.25 2.31015V9.68987C2.25 10.4714 3.10618 10.9508 3.77251 10.5425L9.79362 6.85269C10.4303 6.46254 10.4303 5.53758 9.79363 5.14742Z"]);
const EDIT: (u8, f64, &[&str]) = (12, 1.0, &["M10.161 1.83896C10.92 2.59796 10.92 3.82996 10.161 4.58896L5.38 9.36997C5.131 9.61897 4.821 9.79798 4.481 9.88798L1.25 10.75L2.112 7.51896C2.203 7.17896 2.381 6.86897 2.63 6.61997L7.411 1.83896C8.17 1.07996 9.402 1.07996 10.161 1.83896Z"]);
const PREVIOUS: (u8, f64, &[&str]) = (12, 1.25, &["M7.5 2.5L4 6L7.5 9.5"]);
const NEXT: (u8, f64, &[&str]) = (12, 1.25, &["M4.5 2.5L8 6L4.5 9.5"]);
const DELETE: (u8, f64, &[&str]) = (
    18,
    1.5,
    &[
        "M13.6977 7.75L13.35 14.35C13.294 15.4201 12.416 16.25 11.353 16.25H6.64804C5.58404 16.25 4.70703 15.42 4.65103 14.35L4.30334 7.75",
        "M2.75 4.75H15.25",
        "M6.75 4.75V2.75C6.75 2.2 7.198 1.75 7.75 1.75H10.25C10.802 1.75 11.25 2.2 11.25 2.75V4.75",
    ],
);

/// A button showing only an icon. `label` names it for screen readers.
fn icon_button((size, stroke, paths): (u8, f64, &[&str]), label: String, on_click: impl Fn() + 'static) -> Node {
    Node::new("Button").prop("variant", "ghost").prop("size", "icon-sm").prop("label", label).on("onClick", move |_| on_click()).child(icon(size, stroke, paths))
}

fn small(label: &str, variant: &str, busy: bool, on_click: impl Fn() + 'static) -> Node {
    button(label, variant, busy, on_click).prop("size", "sm")
}

fn loading(what: &str) -> Node {
    row().child(spinner().prop("size", "large")).text(what)
}

pub fn page(s: &State) -> Vec<Node> {
    let mut page = Vec::new();
    match s.phase {
        Phase::Loading => page.push(loading("Loading Cyclops…").key("loading")),
        Phase::Connect => page.push(connect_form(s).key("connect")),
        Phase::Ready => {
            // The buttons go under the name, and under each other, when the sidebar is too narrow for them.
            page.push(
                row().key("head").prop("wrap", true).child(muted(s.name.clone()).prop("size", "small").prop("grow", true)).child(
                    row()
                        .prop("gap", "s")
                        .prop("wrap", true)
                        .child(small("Refresh", "ghost", s.busy.contains("refresh"), reload))
                        .child(small("Open Cyclops", "ghost", false, || host::open_url(WEB)))
                        .child(small("Sign out", "ghost", false, sign_out)),
                ),
            );
            page.extend(s.timers.iter().map(|timer| timer_card(s, timer).key(format!("timer-{}", timer.id))));
            page.push(start_form(s).key("start"));
            page.push(week(s).key("week"));
            page.push(entries(s).key("entries"));
        }
    }
    if let Some(error) = &s.error {
        page.push(text(error.clone()).key("error").prop("tone", "danger").prop("size", "small"));
    }
    page
}

fn connect_form(s: &State) -> Node {
    let busy = s.busy.contains("connect");
    card()
        .child(title("Connect Cyclops"))
        .child(muted("Make a personal API token in Cyclops Settings, then paste it here. Wings keeps it in your keychain."))
        .child(button("Open Cyclops Settings", "ghost", false, || host::open_url(&format!("{WEB}/settings"))))
        .child(
            text_input("API token", &s.token, |token| with(|s| s.token = token))
                .prop("type", "password")
                .prop("placeholder", "cyc_…")
                .on("onKeyDown", |event| {
                    if event["key"] == "Enter" {
                        connect();
                    }
                }),
        )
        .child(button(if busy { "Connecting…" } else { "Connect" }, "default", busy, connect))
}

fn project_name(s: &State, id: &str) -> String {
    s.projects.iter().find(|p| p.id == id).map_or_else(|| "Unknown project".into(), |p| format!("{} · {}", p.client_name, p.name))
}

fn project_line(s: &State, id: &str) -> Node {
    row().prop("gap", "s").child(dot()).child(muted(project_name(s, id)).prop("size", "small").prop("truncate", true))
}

/// Asks before deleting, in place of the row's buttons.
fn confirm(s: &State, id: &str, question: &str, keep: &str) -> Node {
    let busy = s.busy.contains(&format!("delete:{id}"));
    let id = id.to_owned();
    row()
        .child(text(question).prop("grow", true))
        .child(small(if busy { "Deleting…" } else { "Delete" }, "destructive", busy, move || delete(id.clone())))
        .child(small(keep, "ghost", false, close_confirm))
}

fn timer_card(s: &State, timer: &Entry) -> Node {
    if s.editing.as_ref().is_some_and(|draft| draft.id == timer.id) {
        return edit_form(s, timer);
    }
    let busy = s.busy.contains(&format!("stop:{}", timer.id));
    let name = timer.task.as_deref().filter(|task| !task.is_empty()).map_or_else(|| "timer".to_owned(), |task| format!("{task} timer"));
    let (edited, deleted, stopped) = (timer.clone(), timer.id.clone(), timer.id.clone());
    card()
        .child(
            row()
                .child(text(timer.task.clone().filter(|task| !task.is_empty()).unwrap_or_else(|| "No description".into())).prop("weight", "strong").prop("grow", true))
                .child(text(elapsed(&timer.started_at)).prop("weight", "strong").prop("mono", true).prop("numeric", true)),
        )
        .child(if s.confirming.as_deref() == Some(&timer.id) {
            confirm(s, &timer.id, "Delete this timer? Its time won't be saved.", "Keep running")
        } else {
            // The buttons go under the project when the card is too narrow for both.
            row().prop("justify", "between").prop("wrap", true).child(row().child(project_line(s, &timer.project_id))).child(
                row()
                    .child(icon_button(EDIT, format!("Edit {name}"), move || open_edit(&edited)))
                    .child(icon_button(DELETE, format!("Delete {name}"), move || open_confirm(deleted.clone())))
                    .child(Node::new("Button").prop("variant", "destructive").prop("disabled", busy).on("onClick", move |_| stop(&stopped)).text(if busy { "Stopping…" } else { "Stop" })),
            )
        })
}

/// A task field suggesting recent tasks, the project's own first.
fn task_box(s: &State, label: &'static str, placeholder: &'static str, value: &str, project_id: &str, auto_focus: bool, on_text: impl Fn(String) + 'static) -> Node {
    let on_text = std::rc::Rc::new(on_text);
    let picked = on_text.clone();
    combobox(
        Combobox {
            label,
            placeholder,
            value: value.to_owned(),
            query: None,
            options: suggest(s, value, project_id).into_iter().map(|task| Choice { value: task.clone(), label: task, detail: None }).collect(),
            empty: if value.trim().is_empty() { "No recent tasks yet." } else { "No matching tasks." },
            auto_focus,
        },
        move |text| on_text(text.unwrap_or_default()),
        move |task| picked(task.to_owned()),
    )
}

/// A field that finds a project by its name or client. `name` tells its search from the other picker's.
fn project_box(s: &State, name: &'static str, value: &str, on_pick: impl Fn(String) + 'static) -> Node {
    combobox(
        Combobox {
            label: "Project",
            placeholder: "Find a project or client",
            value: s.projects.iter().find(|p| p.id == value).map(|p| format!("{} · {}", p.name, p.client_name)).unwrap_or_default(),
            query: Some(s.searches.get(name).cloned()),
            options: s.projects.iter().map(|p| Choice { value: p.id.clone(), label: p.name.clone(), detail: Some(p.client_name.clone()) }).collect(),
            empty: "No matching projects.",
            auto_focus: false,
        },
        move |search| {
            with(|s| match search {
                Some(search) => s.searches.insert(name, search),
                None => s.searches.remove(name),
            });
        },
        move |id| {
            with(|s| s.searches.remove(name));
            on_pick(id.to_owned());
        },
    )
}

fn start_form(s: &State) -> Node {
    let busy = s.busy.contains("start");
    card().child(task_box(s, "What are you working on?", "What are you working on?", &s.task, &s.project_id, false, |task| with(|s| s.task = task))).child(
        row().child(project_box(s, "project", &s.project_id, |id| with(|s| s.project_id = id))).child(
            Node::new("Button")
                .prop("variant", "default")
                .prop("disabled", busy || s.project_id.is_empty())
                .on("onClick", |_| start_timer())
                .text(if busy { "Starting…" } else { "Start" }),
        ),
    )
}

fn draft(change: impl FnOnce(&mut Draft)) {
    with(|s| {
        if let Some(draft) = &mut s.editing {
            change(draft);
        }
    });
}

fn edit_form(s: &State, entry: &Entry) -> Node {
    let Some(editing) = &s.editing else {
        return card();
    };
    let busy = s.busy.contains(&format!("save:{}", entry.id));
    let (start, end) = range(editing);
    let hint = match (start, end) {
        (Some(start), Some(end)) => duration((end - start) / 60_000.0),
        _ => String::new(),
    };
    let time = |label: &'static str, value: &str, end: bool| {
        field_inline(label, text_input(label, value, move |time| draft(|d| if end { d.end = time } else { d.start = time })).prop("type", "time"))
    };
    let saved = entry.clone();
    card()
        .child(task_box(s, "Task", "What have you worked on?", &editing.task, &editing.project_id, true, |task| draft(|d| d.task = task)))
        .child(project_box(s, "edit-project", &editing.project_id, |id| draft(|d| d.project_id = id)))
        .child(row().child(time(if editing.running { "Started" } else { "Start" }, &editing.start, false)).maybe((!editing.running).then(|| time("End", &editing.end, true))))
        // The duration beside the buttons: beside the times, a 360 px sidebar has no room for it.
        .child(row().child(muted(hint).prop("grow", true)).child(button("Cancel", "ghost", false, close_edit)).child(button(if busy { "Saving…" } else { "Save" }, "default", busy, move || save(&saved))))
}

/// The week's range with arrows, and a button for each of its days with its total.
fn week(s: &State) -> Node {
    let (monday, selected, now) = (shown_week(s), selected_day(s), today());
    let current = monday == week_start(0);
    let loaded = s.weeks.get(&monday);
    let (back, forward) = (add_days(&selected, -7), add_days(&selected, 7));
    let whole = s.whole_week;
    let on_today = selected == now && !whole;
    let days = (0..7).map(|i| {
        let day = add_days(&monday, i);
        let future = day > now;
        let minutes = loaded.filter(|_| !future).map(|entries| minutes_on(s, entries, &day));
        // h:mm, like the title bar, so ten hours and more fit a 360 px sidebar.
        let total = match minutes {
            None => String::new(),
            Some(minutes) if minutes > 0.0 => format!("{}:{:02}", (minutes.round() / 60.0).floor(), minutes.round() % 60.0),
            Some(_) => "–".into(),
        };
        let said = match minutes {
            None => String::new(),
            Some(minutes) if minutes > 0.0 => format!(", {}", duration(minutes)),
            Some(_) => ", nothing logged".into(),
        };
        let pressed = day == selected && !whole;
        let shown = day.clone();
        let total = if minutes.is_some_and(|minutes| minutes > 0.0) { text(total) } else { muted(total) };
        Node::new("Button")
            .key(day.clone())
            .prop("chip", true)
            .prop("pressed", pressed)
            .prop("disabled", future)
            .prop("label", format!("{}{said}", day_label(&day, Some(Style::Long), Some(Style::Long), false)))
            .on("onClick", move |_| {
                if !pressed {
                    with(|s| s.whole_week = false);
                    show(Some(shown.clone()));
                }
            })
            // The day over its hours.
            .child(stack().prop("gap", "none").child(muted(day_label(&day, Some(Style::Short), None, false)).prop("size", "tiny")).child(total.prop("size", "tiny")))
    });
    stack()
        .child(
            row()
                .prop("gap", "xs")
                .prop("wrap", true)
                .child(icon_button(PREVIOUS, "Previous week".into(), move || show(Some(back.clone()))))
                .child(text(week_range(&monday)).prop("size", "small").prop("weight", "medium"))
                .child(icon_button(NEXT, "Next week".into(), move || {
                    if !current {
                        show(Some(forward.clone()));
                    }
                }))
                .child(Node::new("Text").prop("grow", true))
                .child(
                    row()
                        .prop("gap", "xs")
                        .child(button("Week", "ghost", false, || {
                            let day = with(|s| {
                                s.whole_week = !s.whole_week;
                                s.day.clone()
                            });
                            show(day);
                        }))
                        .child(button("Today", "ghost", false, move || {
                            if !on_today {
                                with(|s| s.whole_week = false);
                                show(None);
                            }
                        })),
                ),
        )
        .child(row().prop("gap", "xs").prop("wrap", true).children(days))
}

/// A day's finished entries, each with resume, edit and delete.
fn day_entries(s: &State, day: &str, done: &[&Entry]) -> Node {
    let listed: Vec<&&Entry> = done.iter().filter(|e| e.entry_date == day).collect();
    if listed.is_empty() {
        return muted(if day == today() { "Nothing logged today yet.".to_owned() } else { format!("Nothing logged on {}.", day_name(day)) });
    }
    list().children(listed.into_iter().map(|e| {
        if s.editing.as_ref().is_some_and(|draft| draft.id == e.id) {
            return Node::new("ListItem").key(e.id.clone()).child(edit_form(s, e));
        }
        if s.confirming.as_deref() == Some(&e.id) {
            return Node::new("ListItem").key(e.id.clone()).child(confirm(s, &e.id, "Delete this entry?", "Cancel"));
        }
        let name = e.task.clone().filter(|task| !task.is_empty()).unwrap_or_else(|| "entry".into());
        let (resumed, edited, deleted) = ((*e).clone(), (*e).clone(), e.id.clone());
        let times = format!("{}–{}", clock_time(&e.started_at), e.ended_at.as_deref().map(clock_time).unwrap_or_default());
        list_item(
            [
                stack().prop("gap", "none").prop("grow", true).child(text(e.task.clone().filter(|task| !task.is_empty()).unwrap_or_else(|| "No description".into())).prop("truncate", true)).child(project_line(s, &e.project_id)),
                // The duration over the times, to the right.
                stack()
                    .prop("gap", "none")
                    .child(row().prop("justify", "end").child(text(duration(e.duration_minutes.unwrap_or(0.0))).prop("size", "small").prop("weight", "medium").prop("numeric", true)))
                    .child(row().prop("justify", "end").child(muted(times).prop("size", "small").prop("numeric", true))),
            ],
            row()
                .prop("gap", "xs")
                .child(icon_button(RESUME, format!("Resume {name}"), move || resume(&resumed)).prop("disabled", s.busy.contains(&format!("resume:{}", e.id))))
                .child(icon_button(EDIT, format!("Edit {name}"), move || open_edit(&edited)))
                .child(icon_button(DELETE, format!("Delete {name}"), move || open_confirm(deleted.clone()))),
        )
        .key(e.id.clone())
    }))
}

fn entries(s: &State) -> Node {
    let (day, monday) = (selected_day(s), shown_week(s));
    let current = monday == week_start(0);
    let Some(week) = s.weeks.get(&monday) else {
        return match s.week_error.as_ref().filter(|(failed, _)| *failed == monday) {
            Some((_, message)) => row()
                .child(text(format!("Couldn't load this week. {message}")).prop("tone", "danger").prop("size", "small").prop("grow", true))
                .child(button("Try again", "ghost", false, || show(with(|s| s.day.clone())))),
            None => loading("Loading the week…"),
        };
    };
    let done: Vec<&Entry> = week.iter().filter(|e| e.ended_at.is_some()).collect();
    // The shown week's days that have entries, newest first, or the selected day when there are none.
    let mut days: Vec<String> = if s.whole_week { done.iter().map(|e| e.entry_date.clone()).collect() } else { Vec::new() };
    days.sort();
    days.dedup();
    days.reverse();
    if days.is_empty() {
        days.push(day);
    }
    let total: f64 = done.iter().map(|e| e.duration_minutes.unwrap_or(0.0)).sum::<f64>() + if current { running_minutes(s) } else { 0.0 };
    let summary = |label: String| muted(label).prop("size", "small").prop("weight", "medium");
    stack()
        .children(days.iter().flat_map(|day| {
            [
                row().key(format!("head-{day}")).prop("justify", "between").prop("wrap", true).child(heading(3, day_name(day))).child(summary(duration(minutes_on(s, week, day)))),
                day_entries(s, day, &done).key(format!("list-{day}")),
            ]
        }))
        .child(row().prop("justify", "between").child(summary(if current { "This week".into() } else { week_range(&monday) })).child(summary(duration(total))))
}

// ---------- the popover: `src/ui/Popover.tsx` ----------

/// The popover under the title bar button: the same timers and today's entries as the sidebar, compact, with a manual
/// entry form and no other days.
pub fn popover(s: &State) -> Vec<Node> {
    let mut page = vec![
        row()
            .key("head")
            .child(title("Cyclops"))
            .child(Node::new("Text").prop("grow", true))
            .child(muted(s.name.clone()).prop("size", "small").prop("truncate", true))
            .child(button("Refresh", "ghost", s.busy.contains("refresh"), reload))
            .child(button("Open Cyclops", "ghost", false, || host::open_view("tracker"))),
    ];
    match s.phase {
        Phase::Loading => page.push(loading("Loading Cyclops…").key("loading")),
        Phase::Connect => page.push(muted("Connect Cyclops in the sidebar to track time from here.").key("connect")),
        Phase::Ready => {
            page.extend(s.timers.iter().map(|timer| timer_card(s, timer).key(format!("timer-{}", timer.id))));
            page.push(add_form(s).key("add"));
        }
    }
    // Under the form rather than at the end, which a long day pushes out of the popover.
    if let Some(error) = &s.error {
        page.push(text(error.clone()).key("error").prop("tone", "danger").prop("size", "small"));
    }
    if s.phase == Phase::Ready {
        // Today's finished entries; other days are in the sidebar.
        page.push(match s.weeks.get(&week_start(0)) {
            None => loading("Loading today…").key("today"),
            Some(week) => {
                let done: Vec<&Entry> = week.iter().filter(|e| e.ended_at.is_some()).collect();
                stack().key("today").child(day_entries(s, &today(), &done))
            }
        });
    }
    page
}

/// Starts a timer, or adds an entry for today with a start and an end, and shows today's total.
fn add_form(s: &State) -> Node {
    let manual = s.adding.manual;
    let busy = s.busy.contains(if manual { "add" } else { "start" });
    let total = s.weeks.get(&week_start(0)).map_or_else(|| "–".to_owned(), |week| duration(minutes_on(s, week, &today())));
    let time = |label: &'static str, value: &str, end: bool| {
        field_inline(label, text_input(label, value, move |time| with(|s| if end { s.adding.end = time } else { s.adding.start = time })).prop("type", "time"))
    };
    // The duration beside the button follows the times as you type.
    let hint = if manual && !s.adding.start.is_empty() && s.adding.end > s.adding.start {
        duration((at_time(&today(), &s.adding.end) - at_time(&today(), &s.adding.start)) / 60_000.0)
    } else {
        String::new()
    };
    let label = match (manual, busy) {
        (true, true) => "Adding…",
        (true, false) => "Add",
        (false, true) => "Starting…",
        (false, false) => "Start",
    };
    card()
        .child(
            row()
                .child(chips("Add", &[("timer", "Timer"), ("manual", "Manual")], if manual { "manual" } else { "timer" }, |value| {
                    let manual = value == "manual";
                    with(|s| {
                        if s.adding.manual != manual {
                            s.adding.manual = manual;
                            s.error = None;
                        }
                    });
                }))
                .child(Node::new("Text").prop("grow", true))
                .child(muted("Today · ").prop("size", "small").child(text(total).prop("weight", "medium").prop("numeric", true))),
        )
        .child(task_box(
            s,
            "What are you working on?",
            if manual { "What did you work on?" } else { "What are you working on?" },
            &s.task,
            &s.project_id,
            false,
            |task| with(|s| s.task = task),
        ))
        .child(project_box(s, "project", &s.project_id, |id| with(|s| s.project_id = id)))
        .maybe(manual.then(|| row().child(time("Start", &s.adding.start, false)).child(time("End", &s.adding.end, true))))
        .child(
            row().child(muted(hint).prop("grow", true)).child(
                Node::new("Button")
                    .prop("variant", "default")
                    .prop("disabled", busy || s.project_id.is_empty())
                    .on("onClick", move |_| if manual { add_entry() } else { start_timer() })
                    .text(label),
            ),
        )
}
