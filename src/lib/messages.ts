// What the main script and the pages tell each other.

import { channel } from "wings-plugin-sdk/messages";

export const ch = channel<
  {},
  // A timer or entry changed: started, stopped, edited or deleted, or the token was set or removed.
  { "timers-changed": void }
>();
