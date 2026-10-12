import type { ComponentPropsWithoutRef } from "react";
import { Button } from "wings-plugin-ui";

/** The Cyclops web app's row icons, and arrows for the weeks. */
const ICONS = {
  resume: { size: 12, stroke: 1, paths: ["M9.79363 5.14742L3.77252 1.45752C3.10619 1.04918 2.25 1.52866 2.25 2.31015V9.68987C2.25 10.4714 3.10618 10.9508 3.77251 10.5425L9.79362 6.85269C10.4303 6.46254 10.4303 5.53758 9.79363 5.14742Z"] },
  edit: { size: 12, stroke: 1, paths: ["M10.161 1.83896C10.92 2.59796 10.92 3.82996 10.161 4.58896L5.38 9.36997C5.131 9.61897 4.821 9.79798 4.481 9.88798L1.25 10.75L2.112 7.51896C2.203 7.17896 2.381 6.86897 2.63 6.61997L7.411 1.83896C8.17 1.07996 9.402 1.07996 10.161 1.83896Z"] },
  previous: { size: 12, stroke: 1.25, paths: ["M7.5 2.5L4 6L7.5 9.5"] },
  next: { size: 12, stroke: 1.25, paths: ["M4.5 2.5L8 6L4.5 9.5"] },
  delete: {
    size: 18,
    stroke: 1.5,
    paths: [
      "M13.6977 7.75L13.35 14.35C13.294 15.4201 12.416 16.25 11.353 16.25H6.64804C5.58404 16.25 4.70703 15.42 4.65103 14.35L4.30334 7.75",
      "M2.75 4.75H15.25",
      "M6.75 4.75V2.75C6.75 2.2 7.198 1.75 7.75 1.75H10.25C10.802 1.75 11.25 2.2 11.25 2.75V4.75",
    ],
  },
};

/** A button showing only an icon. `label` names it for screen readers. */
export function IconButton({ name, label, ...props }: { name: keyof typeof ICONS; label: string } & ComponentPropsWithoutRef<"button">) {
  const { size, stroke, paths } = ICONS[name];
  return (
    <Button variant="ghost" className={`icon ${name}`} aria-label={label} title={label} {...props}>
      <svg viewBox={`0 0 ${size} ${size}`} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </Button>
  );
}
