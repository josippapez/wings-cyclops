// The Cyclops sidebar: connect with a personal API token, start and stop timers, and see the week.
// Every request goes through wings.fetch, which adds the token in Wings, so this page never holds it.

import { Page } from "../ui/Page";
import { Sidebar as View } from "../ui/Sidebar";
import "../ui/sidebar.css";

export const page = { place: "sidebar" };

export default function Sidebar() {
  return <Page view={View} />;
}
