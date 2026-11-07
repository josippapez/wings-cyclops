import { Button, Card, Row } from "wings-plugin-ui";

import { startTimer } from "../lib/data";
import { state } from "../lib/state";
import { ProjectBox, TaskBox } from "./Combobox";

export function Start() {
  const busy = state.busy.has("start");
  const submit = () => {
    if (!state.projectId) return;
    startTimer();
  };
  return (
    <Card
      as="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <TaskBox id="task" label="What are you working on?" placeholder="What are you working on?" text={() => state.task} onChange={(task) => (state.task = task)} projectId={() => state.projectId} />
      <Row>
        <ProjectBox id="project" value={() => state.projectId} onChange={(id) => (state.projectId = id)} />
        {/* The native app has no form to submit. */}
        <Button variant="default" type="submit" disabled={busy || !state.projectId} onClick={WINGS_NATIVE ? submit : undefined}>
          {busy ? "Starting…" : "Start"}
        </Button>
      </Row>
    </Card>
  );
}
