import { Button, Card, Dot, Row, Text } from "wings-plugin-ui";

import { api } from "../lib/api";
import { act } from "../lib/data";
import { elapsed } from "../lib/dates";
import { openConfirm, openEdit } from "../lib/edit";
import { state } from "../lib/state";
import type { Entry } from "../lib/types";
import { Confirm } from "./Confirm";
import { Edit } from "./Edit";
import { IconButton } from "./Icons";

const projectName = (id: string) => {
  const p = state.projects.find((x) => x.id === id);
  return p ? `${p.clientName} · ${p.name}` : "Unknown project";
};

export const ProjectLine = ({ id }: { id: string }) => (
  <Row gap="s">
    <Dot />
    <Text size="small" tone="muted" truncate>
      {projectName(id)}
    </Text>
  </Row>
);

export function Timer({ timer }: { timer: Entry }) {
  if (state.editing?.id === timer.id)
    return <Edit entry={timer} />;
  const key = `stop:${timer.id}`;
  const name = timer.task ? `${timer.task} timer` : "timer";
  return (
    <Card as="section" className="timer">
      <Row>
        <Text as="div" weight="strong" grow className="task">
          {timer.task || "No description"}
        </Text>
        <div className="clock" data-started={timer.startedAt}>
          {elapsed(timer.startedAt)}
        </div>
      </Row>
      {state.confirming === timer.id ? (
        <Confirm entry={timer} question="Delete this timer? Its time won't be saved." keep="Keep running" after="task" />
      ) : (
        <Row>
          <Row grow>
            <ProjectLine id={timer.projectId} />
          </Row>
          <IconButton name="edit" label={`Edit ${name}`} id={`edit-${timer.id}`} onClick={() => openEdit(timer)} />
          <IconButton name="delete" label={`Delete ${name}`} id={`delete-${timer.id}`} onClick={() => openConfirm(timer.id)} />
          <Button variant="destructive" disabled={state.busy.has(key)} onClick={() => void act(key, () => api(`/time-entries/${timer.id}/stop`, { method: "POST" }))}>
            {state.busy.has(key) ? "Stopping…" : "Stop"}
          </Button>
        </Row>
      )}
    </Card>
  );
}
