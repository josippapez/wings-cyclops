// ---------- fields with suggestions ----------

import { useReducer } from "react";
import { Combobox } from "wings-plugin-ui";

import { suggest } from "../lib/data";
import { focus, state } from "../lib/state";
import type { Project } from "../lib/types";

/**
 * Typing or picking changes `state` without drawing the page again, so a field draws itself again to show it.
 * Its list opens when it gets focus, but not when the page is putting focus back into it after this render.
 */
function useField(id: string) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  return { redraw, openOnFocus: focus.next !== id };
}

const projectLabel = (p: Project) => `${p.name} · ${p.clientName}`;

/** A task field suggesting recent tasks, the project's own first. */
export function TaskBox(o: { id: string; label: string; placeholder: string; text: () => string; onChange: (task: string) => void; projectId: () => string }) {
  const { redraw, openOnFocus } = useField(o.id);
  const text = o.text();
  const change = (task: string) => {
    o.onChange(task);
    redraw();
  };
  return (
    <Combobox
      className="combo"
      id={o.id}
      label={o.label}
      placeholder={o.placeholder}
      maxLength={2000}
      freeText
      openOnFocus={openOnFocus}
      value={text}
      onInput={change}
      options={suggest(text, o.projectId()).map((s) => ({ value: s.task, label: s.task }))}
      onPick={(option) => change(option.value)}
      empty={text.trim() ? "No matching tasks." : "No recent tasks yet."}
    />
  );
}

/** A field that finds a project by its name or client. */
export function ProjectBox({ id, value, onChange }: { id: string; value: () => string; onChange: (id: string) => void }) {
  const { redraw, openOnFocus } = useField(id);
  const picked = state.projects.find((x) => x.id === value());
  return (
    <Combobox
      className="combo"
      id={id}
      label="Project"
      placeholder="Find a project or client"
      maxLength={2000}
      openOnFocus={openOnFocus}
      value={picked ? projectLabel(picked) : ""}
      options={state.projects.map((p) => ({ value: p.id, label: p.name, detail: p.clientName }))}
      onPick={(option) => {
        onChange(option.value);
        redraw();
      }}
      empty="No matching projects."
    />
  );
}
