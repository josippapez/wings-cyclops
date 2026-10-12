import { Button, Card, Row } from "wings-plugin-ui";

import { startTimer } from "../lib/data";
import { state } from "../lib/state";
import { ProjectBox, TaskBox } from "./Combobox";

export function Start() {
  const busy = state.busy.has("start");
  return (
    <Card
      as="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!state.projectId) return;
        startTimer();
      }}
    >
      <TaskBox id="task" label="What are you working on?" placeholder="What are you working on?" text={() => state.task} onChange={(task) => (state.task = task)} projectId={() => state.projectId} />
      <Row>
        <ProjectBox id="project" value={() => state.projectId} onChange={(id) => (state.projectId = id)} />
        <Button variant="default" type="submit" disabled={busy || !state.projectId}>
          {busy ? "Starting…" : "Start"}
        </Button>
      </Row>
    </Card>
  );
}
