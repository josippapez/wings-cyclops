import { useState } from "react";
import { Button, Card, Text, TextInput, Title } from "wings-plugin-ui";

import { api, SignedOut, WEB } from "../lib/api";
import { act, loadHistory } from "../lib/data";
import { focus, state } from "../lib/state";
import type { Me, Project } from "../lib/types";

export function Connect() {
  const [token, setToken] = useState("");
  const busy = state.busy.has("connect");
  return (
    <Card
      as="form"
      className="connect"
      onSubmit={(e) => {
        e.preventDefault();
        if (!token.trim()) return;
        void act("connect", async () => {
          await wings.secrets.set("token", token.trim());
          try {
            state.me = await api<Me>("/auth/me");
            state.projects = await api<Project[]>("/projects");
            await loadHistory();
          } catch (error) {
            await wings.secrets.delete("token");
            // The token stays in its field, with focus, to be corrected.
            focus.next = "token";
            throw error instanceof SignedOut ? new Error("That token didn't work. Check it's a Cyclops API token starting with cyc_.") : error;
          }
          state.phase = "ready";
        });
      }}
    >
      <Title>Connect Cyclops</Title>
      <Text as="p" tone="muted">
        Make a personal API token in Cyclops Settings, then paste it here. Wings keeps it in your keychain.
      </Text>
      <Button variant="ghost" className="start" onClick={() => void wings.openUrl(`${WEB}/settings`)}>
        Open Cyclops Settings
      </Button>
      <TextInput id="token" type="password" label="API token" placeholder="cyc_…" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
      <Button variant="default" type="submit" busy={busy}>
        {busy ? "Connecting…" : "Connect"}
      </Button>
    </Card>
  );
}
