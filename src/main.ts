// Keeps the running timer on the clock button, and runs the tools Claude calls. The sidebar and this script tell each
// other about changes with the channel, so a timer started in one shows in the other at once. Changes made elsewhere
// show on the next 30 s poll while Wings is in front, at once when it comes back, or on Refresh.

import { pollWhileFocused } from "wings-plugin-sdk/poll";
import { registerTools } from "wings-plugin-sdk/tools";

import { ch } from "./lib/messages";
import { refreshLabel } from "./main/label";
import { tools } from "./tools";

// The sidebar started, stopped or resumed a timer, or connected or signed out.
ch.on("timers-changed", () => void refreshLabel());

void refreshLabel();
// Two requests a minute stay far below Cyclops's limit of 100 per token, and none go out while Wings is in the
// background: the label is checked again the moment you come back.
pollWhileFocused(() => void refreshLabel(), 30_000);

registerTools(tools);
