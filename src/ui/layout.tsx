// Cyclops' own boxes: HTML tags in the browser, styled by sidebar.css, and wings-plugin-ui's in the native app, which
// draws no HTML.
import { createElement, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import * as native from "./layout-native";

function wrapper(tag: "div" | "span" | "strong" | "h2" | "ul" | "li") {
  return function Layout(props: HTMLAttributes<HTMLElement>) {
    return WINGS_NATIVE ? <native.Layout tag={tag} {...props} /> : createElement(tag, props);
  };
}

export const Box = wrapper("div");
export const Inline = wrapper("span");
export const Strong = wrapper("strong");
export const H2 = wrapper("h2");
export const Unordered = wrapper("ul");
export const Item = wrapper("li");

/** A day of the week strip: its click handler gets no event. */
export type DayButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & { onClick?: () => void };

export function DayButton(props: DayButtonProps) {
  return WINGS_NATIVE ? <native.DayButton {...props} /> : createElement("button", props);
}
