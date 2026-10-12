// ---------- the popover ----------

import { useReducer } from "react";
import { Button, Card, Chips, Field, Row, Spinner, Stack, Text, TextInput, Title } from "wings-plugin-ui";

import { api } from "../lib/api";
import { act, newEntry, startTimer } from "../lib/data";
import { duration, minutesOn, today, weekStart } from "../lib/dates";
import { range } from "../lib/edit";
import { set, state } from "../lib/state";
import { ProjectBox, TaskBox } from "./Combobox";
import { DayEntries } from "./Days";
import { Timer } from "./Timer";

/** The popover's title, with a way to the sidebar for everything else. */
function Head() {
  return (
    <Row as="header" className="head">
      <Title>Cyclops</Title>
      <Text grow />
      <Text tone="muted" size="small" truncate>
        {state.me?.name ?? ""}
      </Text>
      <Button variant="ghost" id="open-sidebar" onClick={() => void wings.openView("tracker")}>
        Open Cyclops
      </Button>
    </Row>
  );
}

/** Starts a timer, or adds an entry for today with a start and an end, and shows today's total. */
function Add() {
  const adding = state.adding;
  const manual = adding.mode === "manual";
  const busy = state.busy.has(manual ? "add" : "start");
  const week = state.weeks.get(weekStart());
  // The duration beside the times follows them as you type, without drawing the page again.
  const [, showDuration] = useReducer((n: number) => n + 1, 0);
  const { start, end } = range({ day: today(), start: adding.start, end: adding.end });
  const hint = (
    <Text tone="muted" grow>
      {start && end && adding.end > adding.start ? duration((end.getTime() - start.getTime()) / 60_000) : ""}
    </Text>
  );
  const time = (field: "start" | "end", label: string) => (
    <Field inline label={label} id={`add-${field}`}>
      <TextInput
        type="time"
        value={adding[field]}
        onChange={(e) => {
          adding[field] = e.target.value;
          showDuration();
        }}
      />
    </Field>
  );
  return (
    <Card
      as="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !state.projectId) return;
        if (!manual) return startTimer();
        if (!adding.start || !adding.end) return set({ error: "Enter a start and an end time." });
        if (adding.end <= adding.start) return set({ error: "The end time must be after the start." });
        const { start, end } = range({ day: today(), start: adding.start, end: adding.end });
        const body = { ...newEntry(), startedAt: start?.toISOString(), endedAt: end?.toISOString() };
        void act("add", async () => {
          await api("/time-entries", { method: "POST", body });
          state.task = "";
          adding.start = adding.end = "";
        });
      }}
    >
      <Row>
        <Chips
          label="Add"
          options={[
            { value: "timer", label: "Timer", id: "mode-timer" },
            { value: "manual", label: "Manual", id: "mode-manual" },
          ]}
          value={adding.mode}
          onChange={(value) => adding.mode === value || ((adding.mode = value), set({ error: null }))}
        />
        <Text grow />
        <Text tone="muted" size="small" className="today">
          {"Today · "}
          <Text as="strong" weight="medium" numeric id="today-total">
            {week ? duration(minutesOn(week, today())) : "–"}
          </Text>
        </Text>
      </Row>
      <TaskBox id="task" label="What are you working on?" placeholder={manual ? "What did you work on?" : "What are you working on?"} text={() => state.task} onChange={(task) => (state.task = task)} projectId={() => state.projectId} />
      <ProjectBox id="project" value={() => state.projectId} onChange={(id) => (state.projectId = id)} />
      {manual ? (
        <Row>
          {time("start", "Start")}
          {time("end", "End")}
        </Row>
      ) : null}
      <Row>
        {manual ? hint : <Text grow />}
        <Button variant="default" type="submit" disabled={busy || !state.projectId}>
          {manual ? (busy ? "Adding…" : "Add") : busy ? "Starting…" : "Start"}
        </Button>
      </Row>
    </Card>
  );
}

/** Today's finished entries; other days are in the sidebar. */
function Today() {
  const week = state.weeks.get(weekStart());
  if (!week)
    return (
      <Row className="muted">
        <Spinner size="large" />
        Loading today…
      </Row>
    );
  return (
    <Stack as="section" aria-label="Today's entries">
      <DayEntries day={today()} done={week.filter((e) => e.endedAt)} />
    </Stack>
  );
}

export function Popover() {
  return (
    <>
      <Head />
      {state.phase === "loading" ? (
        <Row className="muted">
          <Spinner size="large" />
          Loading Cyclops…
        </Row>
      ) : null}
      {state.phase === "connect" ? (
        <Text as="p" tone="muted">
          Connect Cyclops in the sidebar to track time from here.
        </Text>
      ) : null}
      {state.phase === "ready" ? (
        <>
          {state.timers.map((t) => (
            <Timer key={t.id} timer={t} />
          ))}
          <Add />
        </>
      ) : null}
      {/* Under the form rather than at the end, which a long day pushes out of the popover. */}
      {state.error ? (
        <Text as="p" tone="danger" size="small" role="alert">
          {state.error}
        </Text>
      ) : null}
      {state.phase === "ready" ? <Today /> : null}
    </>
  );
}
