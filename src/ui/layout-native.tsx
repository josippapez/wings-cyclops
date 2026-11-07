import { useEffect, useState, type HTMLAttributes } from "react";
import { Chip, List, ListItem, Row, Stack, Text } from "wings-plugin-ui";

import { elapsed } from "../lib/dates";
import type { DayButtonProps } from "./layout";

export function Layout({ tag, className = "", children, ...props }: HTMLAttributes<HTMLElement> & { tag: string; "data-started"?: string }) {
  const classes = className.split(" ");
  if (classes.includes("clock")) return <Clock started={props["data-started"] ?? ""} />;
  if (tag === "ul") return <List>{children}</List>;
  // An entry's task, times and buttons side by side. In the browser the buttons show in place of the times on hover.
  if (tag === "li") return <ListItem>{classes.includes("entry") ? <Row gap="s">{children}</Row> : children}</ListItem>;
  if (classes.includes("days"))
    return (
      <Row gap="xs" wrap>
        {children}
      </Row>
    );
  if (classes.includes("actions")) return <Row gap="xs">{children}</Row>;
  if (classes.includes("when")) return <Stack gap="none">{children}</Stack>;
  if (tag === "strong") return <Text weight="medium">{children}</Text>;
  if (tag === "h2")
    return (
      <Text size="small" weight="medium">
        {children}
      </Text>
    );
  if (tag === "span")
    return (
      <Text size="tiny" tone={classes.includes("muted") || classes.includes("name") ? "muted" : undefined}>
        {children}
      </Text>
    );
  return <Stack gap="s">{children}</Stack>;
}

/** A running timer's clock, ticking each second. In the browser the page sets the clocks' text itself instead. */
function Clock({ started }: { started: string }) {
  const [shown, setShown] = useState(() => elapsed(started));
  useEffect(() => {
    const tick = setInterval(() => setShown(elapsed(started)), 1000);
    return () => clearInterval(tick);
  }, [started]);
  return (
    <Text weight="strong" mono numeric>
      {shown}
    </Text>
  );
}

/** A day of the week strip, pressed when it's the day shown. */
export function DayButton({ onClick, disabled, children, ...props }: DayButtonProps) {
  const pressed = props["aria-pressed"] === true || props["aria-pressed"] === "true";
  return (
    <Chip pressed={pressed} disabled={disabled} aria-label={props["aria-label"]} onClick={onClick}>
      {/* The day over its hours, as the browser's .day stacks them. */}
      <Stack gap="none">{children}</Stack>
    </Chip>
  );
}
