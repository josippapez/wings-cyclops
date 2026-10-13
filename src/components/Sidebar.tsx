import { Button, Row, Spinner, Text } from "wings-plugin-ui";

import { WEB } from "../lib/api";
import { reload } from "../lib/data";
import { set, state } from "../lib/state";
import { Connect } from "./Connect";
import { Entries, Week } from "./Days";
import { Start } from "./Start";
import { Timer } from "./Timer";

export function Sidebar() {
  return (
    <>
      {state.phase === "loading" ? (
        <Row className="muted">
          <Spinner size="large" />
          Loading Cyclops…
        </Row>
      ) : null}
      {state.phase === "connect" ? <Connect /> : null}
      {state.phase === "ready" ? (
        <>
          <Row>
            <Text tone="muted" size="small" grow>
              {state.me?.name ?? ""}
            </Text>
            <Button variant="ghost" size="sm" busy={state.busy.has("refresh")} title="Reload from Cyclops, after a change made elsewhere" onClick={reload}>
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void wings.openUrl(WEB)}>
              Open Cyclops
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Removes the token from this Mac. It stays valid until you revoke it in Cyclops Settings."
              onClick={async () => {
                await wings.secrets.delete("token");
                void wings.broadcast({ type: "timers-changed" });
                set({ phase: "connect", me: null, timers: [], weeks: new Map(), day: null, weekError: null });
              }}
            >
              Sign out
            </Button>
          </Row>
          {state.timers.map((t) => (
            <Timer key={t.id} timer={t} />
          ))}
          <Start />
          <Week />
          <Entries />
        </>
      ) : null}
      {state.error ? (
        <Text as="p" tone="danger" size="small" role="alert">
          {state.error}
        </Text>
      ) : null}
    </>
  );
}
