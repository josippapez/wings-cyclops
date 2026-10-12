// The popover under the Cyclops title bar button: the same timers and today's entries as the sidebar, compact,
// with a manual entry form and no other days.

import { showPopover } from "wings-plugin-ui";

import { Page, startPage } from "./components/Page";
import { Popover } from "./components/Popover";
import "./sidebar.css";

showPopover(
  <Page view={Popover} />,
);
startPage();
