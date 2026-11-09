import { Children, isValidElement, useEffect, useState, type HTMLAttributes } from "react";
import { Chip, List, ListItem, Row, Stack, Text } from "wings-plugin-ui";

import { elapsed } from "../lib/dates";
import type { DayButtonProps } from "./layout";

export function Layout({ tag, className = "", children, ...props }: HTMLAttributes<HTMLElement> & { tag: string; "data-started"?: string }) {
  const classes = className.split(" ");
  if (classes.includes("clock")) return <Clock started={props["data-started"] ?? ""} />;
  if (tag === "ul") return <List>{children}</List>;
  // An entry's task and times side by side, and its buttons in place of the times while you point at it or tab into
  // them, as in the browser.
  if (tag === "li") {
    const parts = Children.toArray(children);
    const actions = parts.find((part) => isValidElement<{ className?: string }>(part) && part.props.className === "actions");
    return <ListItem actions={actions}>{parts.filter((part) => part !== actions)}</ListItem>;
  }
  if (classes.includes("days"))
    return (
      <Row gap="xs" wrap>
        {children}
      </Row>
    );
  if (classes.includes("actions")) return <Row gap="xs">{children}</Row>;
  // sidebar.css's `.entry .when`: the duration over the times, at 12px, to the right.
  if (classes.includes("when"))
    return (
      <Stack gap="none">
        {Children.map(children, (line) => (
          <Row justify="end">{typeof line === "string" ? <Text size="small" tone="muted" numeric>{line}</Text> : line}</Row>
        ))}
      </Stack>
    );
  if (tag === "strong") return <Text size="small" weight="medium" numeric>{children}</Text>;
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
