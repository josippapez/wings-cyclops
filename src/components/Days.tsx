import { Fragment } from "react";
import { Button, Heading, Row, Spinner, Stack, Text } from "wings-plugin-ui";

import { api } from "../lib/api";
import { act, selectedDay, show, shownWeek } from "../lib/data";
import { addDays, clockTime, dayLabel, dayName, duration, minutesOn, runningMinutes, today, weekRange, weekStart } from "../lib/dates";
import { openConfirm, openEdit } from "../lib/edit";
import { state } from "../lib/state";
import type { Entry } from "../lib/types";
import { Confirm } from "./Confirm";
import { Edit } from "./Edit";
import { IconButton } from "./Icons";
import { ProjectLine } from "./Timer";

/** The week's range with arrows, and a button for each of its days with its total. */
export function Week() {
  const monday = shownWeek();
  const selected = selectedDay();
  const now = today();
  const current = monday === weekStart();
  const entries = state.weeks.get(monday);
  return (
    <Stack as="section" aria-label="Week">
      <Row gap="xs">
        <IconButton name="previous" label="Previous week" id="week-previous" onClick={() => show(addDays(selected, -7))} />
        <h2 className="range">{weekRange(monday)}</h2>
        {/* aria-disabled rather than disabled, as in the Cyclops web app, so focus stays on the button that got you here. */}
        <IconButton name="next" label="Next week" id="week-next" aria-disabled={current ? "true" : undefined} onClick={() => current || show(addDays(selected, 7))} />
        <Text grow />
        <Button variant="ghost" id="week-all" aria-pressed={state.wholeWeek} onClick={() => ((state.wholeWeek = !state.wholeWeek), show(state.day))}>
          Week
        </Button>
        <Button
          variant="ghost"
          id="week-today"
          aria-disabled={selected === now && !state.wholeWeek ? "true" : undefined}
          onClick={() => (selected === now && !state.wholeWeek) || ((state.wholeWeek = false), show(null))}
        >
          Today
        </Button>
      </Row>
      <div className="days">
        {Array.from({ length: 7 }, (_, i) => {
          const day = addDays(monday, i);
          const future = day > now;
          const minutes = entries && !future ? minutesOn(entries, day) : null;
          // h:mm, like the title bar, so ten hours and more fit a 360 px sidebar.
          const total = minutes === null ? "" : minutes ? `${Math.floor(Math.round(minutes) / 60)}:${String(Math.round(minutes) % 60).padStart(2, "0")}` : "–";
          return (
            <button
              key={day}
              className="day"
              type="button"
              id={`day-${day}`}
              aria-pressed={day === selected && !state.wholeWeek}
              aria-current={day === now ? "date" : undefined}
              aria-label={`${dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}${minutes === null ? "" : `, ${minutes ? duration(minutes) : "nothing logged"}`}`}
              disabled={future}
              onClick={() => (day === selected && !state.wholeWeek) || ((state.wholeWeek = false), show(day))}
            >
              <span className="name">{dayLabel(day, { weekday: "short", day: "numeric" })}</span>
              <span className={minutes ? "total" : "total muted"}>{total}</span>
            </button>
          );
        })}
      </div>
    </Stack>
  );
}

/** The shown week's days that have entries, newest first, or the selected day when there are none. */
function weekDays(week: Entry[]) {
  const days = [...new Set(week.filter((e) => e.endedAt).map((e) => e.entryDate))].sort().reverse();
  return days.length ? days : [selectedDay()];
}

/** A day's heading and total over its entries. */
const DaySection = ({ week, day, done }: { week: Entry[]; day: string; done: Entry[] }) => (
  <>
    <Heading
      level={3}
      actions={
        <Text tone="muted" size="small" weight="medium">
          {duration(minutesOn(week, day))}
        </Text>
      }
    >
      {dayName(day)}
    </Heading>
    <DayEntries day={day} done={done} />
  </>
);

/** A day's finished entries, each with resume, edit and delete. */
export function DayEntries({ day, done }: { day: string; done: Entry[] }) {
  const listed = done.filter((e) => e.entryDate === day);
  if (listed.length === 0)
    return (
      <Text as="p" tone="muted">
        {day === today() ? "Nothing logged today yet." : `Nothing logged on ${dayName(day)}.`}
      </Text>
    );
  return (
    <ul className="entries">
      {listed.map((e, i) => {
        if (state.editing?.id === e.id)
          return (
            <li key={e.id}>
              <Edit entry={e} />
            </li>
          );
        // Once this row is gone, focus moves to the same button on the next one.
        const neighbour = listed[i + 1] ?? listed[i - 1];
        if (state.confirming === e.id)
          return (
            <li key={e.id} className="entry">
              <Confirm entry={e} question="Delete this entry?" keep="Cancel" after={neighbour ? `delete-${neighbour.id}` : `day-${day}`} />
            </li>
          );
        const key = `resume:${e.id}`;
        const name = e.task || "entry";
        return (
          <li key={e.id} className="entry">
            <Stack gap="none" grow>
              <Text as="div" truncate>
                {e.task || "No description"}
              </Text>
              <ProjectLine id={e.projectId} />
            </Stack>
            <div className="when">
              <strong>{duration(e.durationMinutes ?? 0)}</strong>
              {`${clockTime(e.startedAt)}–${clockTime(e.endedAt!)}`}
            </div>
            <div className="actions">
              <IconButton
                name="resume"
                label={`Resume ${name}`}
                disabled={state.busy.has(key)}
                onClick={() => void act(key, () => api("/time-entries/timer", { method: "POST", body: e.task ? { projectId: e.projectId, task: e.task } : { projectId: e.projectId } }))}
              />
              <IconButton name="edit" label={`Edit ${name}`} id={`edit-${e.id}`} onClick={() => openEdit(e)} />
              <IconButton name="delete" label={`Delete ${name}`} id={`delete-${e.id}`} onClick={() => openConfirm(e.id)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Entries() {
  const day = selectedDay();
  const monday = shownWeek();
  const week = state.weeks.get(monday);
  const current = monday === weekStart();
  if (!week) {
    const failed = state.weekError?.week === monday ? state.weekError : null;
    return failed ? (
      <Row>
        <Text as="p" tone="danger" size="small" grow role="alert">{`Couldn't load this week. ${failed.message}`}</Text>
        <Button variant="ghost" id="week-retry" onClick={() => show(state.day)}>
          Try again
        </Button>
      </Row>
    ) : (
      <Row className="muted">
        <Spinner size="large" />
        Loading the week…
      </Row>
    );
  }
  const done = week.filter((e) => e.endedAt);
  const sum = (list: Entry[]) => list.reduce((n, e) => n + (e.durationMinutes ?? 0), 0);
  return (
    <Stack as="section">
      {(state.wholeWeek ? weekDays(week) : [day]).map((d) => (
        <Fragment key={d}>
          <DaySection week={week} day={d} done={done} />
        </Fragment>
      ))}
      <Row justify="between">
        <Text tone="muted" size="small" weight="medium">
          {current ? "This week" : weekRange(monday)}
        </Text>
        <Text tone="muted" size="small" weight="medium" id="week-total">
          {duration(sum(done) + (current ? runningMinutes() : 0))}
        </Text>
      </Row>
    </Stack>
  );
}
