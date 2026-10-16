// The main script's requests: the page's `api`, with the messages the title bar button and Claude's tools show.

import { api as request, SignedOut } from "../lib/api";

export async function api<T = unknown>(path: string, options?: { method?: string; body?: object }): Promise<T> {
  if (!(await wings.secrets.has("token"))) throw new Error("Cyclops isn't connected. Open the Cyclops sidebar in Wings and connect it.");
  try {
    return await request<T>(path, options);
  } catch (error) {
    if (error instanceof SignedOut) throw new Error("Cyclops didn't accept the saved token. Connect again in the Cyclops sidebar.");
    throw error;
  }
}
