import { useReducer } from "react";
import { Button, Card, Field, Row, Text, TextInput } from "wings-plugin-ui";

import { api } from "../lib/api";
import { act } from "../lib/data";
import { duration } from "../lib/dates";
import { changes, closeEdit, range } from "../lib/edit";
import { focus, set, state, type Draft } from "../lib/state";
import type { Entry } from "../lib/types";
import { ProjectBox, TaskBox } from "./Combobox";

export function Edit({ entry }: { entry: Entry }) {
  const draft = state.editing as Draft;
  const key = `save:${entry.id}`;
  const busy = state.busy.has(key);
  // The duration under the times follows them as you type, without drawing the page again.
  const [, showDuration] = useReducer((n: number) => n + 1, 0);
  const { start, end } = range(draft);
  const hint = (
    <Text tone="muted" grow>
      {start && end ? duration((end.getTime() - start.getTime()) / 60_000) : ""}
    </Text>
  );
  const time = (field: "start" | "end", label: string) => (
    <Field inline label={label} id={`edit-${field}`}>
      <TextInput
        type="time"
        value={draft[field]}
        onChange={(e) => {
          draft[field] = e.target.value;
          showDuration();
        }}
      />
    </Field>
  );
  return (
    <Card
      as="form"
      aria-label={`Edit ${entry.task || (draft.running ? "timer" : "entry")}`}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        closeEdit(entry.id);
      }}
      onSubmit={(e) => {
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
          focus.next = `edit-${entry.id}`;
        });
      }}
    >
      <TaskBox id="edit-task" label="Task" placeholder="What have you worked on?" text={() => draft.task} onChange={(task) => (draft.task = task)} projectId={() => draft.projectId} />
      <ProjectBox id="edit-project" value={() => draft.projectId} onChange={(id) => (draft.projectId = id)} />
      <Row>
        {time("start", draft.running ? "Started" : "Start")}
        {draft.running ? null : time("end", "End")}
      </Row>
      {/* The duration beside the buttons, as in the popover: beside the times, a 360 px sidebar has no room for it. */}
      <Row>
        {hint}
        <Button variant="ghost" onClick={() => closeEdit(entry.id)}>
          Cancel
        </Button>
        <Button variant="default" type="submit" id="edit-save" busy={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </Row>
    </Card>
  );
}
