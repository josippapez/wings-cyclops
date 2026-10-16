import { Button, Row, Text } from "wings-plugin-ui";

import { api } from "../lib/api";
import { act } from "../lib/data";
import { closeConfirm } from "../lib/edit";
import { focus, state } from "../lib/state";
import type { Entry } from "../lib/types";

/** Asks before deleting, in place of the row's buttons. `after` is the id that gets focus once it's gone. */
export function Confirm({ entry, question, keep, after }: { entry: Entry; question: string; keep: string; after: string }) {
  const key = `delete:${entry.id}`;
  const busy = state.busy.has(key);
  return (
    <Row className="confirm" role="group" aria-labelledby={`question-${entry.id}`} onKeyDown={(e) => e.key === "Escape" && closeConfirm(entry.id)}>
      <Text grow id={`question-${entry.id}`}>
        {question}
      </Text>
      <Button
        variant="destructive"
        size="sm"
        id={`confirm-${entry.id}`}
        busy={busy}
        onClick={() => {
          void act(key, async () => {
            await api(`/time-entries/${entry.id}`, { method: "DELETE" });
            if (state.confirming === entry.id) state.confirming = null;
            focus.next = after;
          });
        }}
      >
        {busy ? "Deleting…" : "Delete"}
      </Button>
      <Button variant="ghost" size="sm" id={`keep-${entry.id}`} onClick={() => closeConfirm(entry.id)}>
        {keep}
      </Button>
    </Row>
  );
}
