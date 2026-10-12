// The Cyclops sidebar: connect with a personal API token, start and stop timers, and see the week.
// Every request goes through wings.fetch, which adds the token in Wings, so this page never holds it.

import { showSidebar } from "wings-plugin-ui";

import { Page, startPage } from "./components/Page";
import { Sidebar } from "./components/Sidebar";
import "./sidebar.css";

showSidebar(
  <Page view={Sidebar} />,
);
startPage();
