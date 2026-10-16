// The popover under the Cyclops title bar button: the same timers and today's entries as the sidebar, compact,
// with a manual entry form and no other days.

import { Page } from "../ui/Page";
import { Popover as View } from "../ui/Popover";
import "../ui/sidebar.css";

export const page = { place: "popover" };

export default function Popover() {
  return <Page view={View} />;
}
