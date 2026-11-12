# Cyclops for Wings

Adds a clock button to the Wings title bar that opens Cyclops in the right sidebar. Start and stop timers, resume, edit and delete entries and running timers, and see each day's and week's totals. While a timer runs, the button shows how long.

Point at the clock button, or tab to it, and a popover shows today: running timers with Stop, a form that starts a timer or, under Manual, adds an entry for today from a start and an end time, today's total, and today's entries to resume, edit or delete. Open Cyclops in the popover, or a click on the button, opens the sidebar for other days and weeks.

The arrows above the entries move a week back or forward, and each day's button shows that day's entries and total. Today brings you back. Week lists every day of the week with its entries and total, like the Cyclops web app. This week reloads every minute while Wings is in front, when you come back to Wings, and when the sidebar or popover is shown again. Refresh, in both, reloads at once, for a timer or entry changed in the Cyclops web app or another app. An earlier week loads once, when you first go to it.

## Connect

The sidebar asks for a personal API token. Make one in Cyclops under Settings, API tokens (the sidebar has a button that opens it), and paste it in. Wings keeps it in your keychain and adds it to requests itself, so the plugin's code never holds it. Sign out removes it from this Mac. Revoke it in Cyclops Settings to stop it working anywhere.

## Claude

With Wings connected to Claude Code (Plugins, Claude Code, Connect), Claude gets these tools. They use the same token, so connect the sidebar first.

- `cyclops__list_projects`: projects with their ids and clients.
- `cyclops__running_timers`: your running timers.
- `cyclops__start_timer` and `cyclops__stop_timer`: start a timer on a project, and stop one.
- `cyclops__list_entries`: your entries between two days, today by default, with their ids.
- `cyclops__update_entry`: change an entry's task, project, start or end. Ending a running timer stops it.
- `cyclops__delete_entry`: delete an entry, or a running timer without saving it. This can't be undone.

## Install

The plugin is written twice. In Wings 0.2.17 and later it runs from Rust: `rust/` builds its title bar button and tools, its sidebar and its popover to WebAssembly, with the Rust SDK in the Wings repo (`packages/plugin-rs`). The TypeScript and React in `src/`, built with [wings-plugin-sdk](https://www.npmjs.com/package/wings-plugin-sdk), is the same plugin and ships beside it. The repo holds only source. Build the package:

```sh
rustup target add wasm32-unknown-unknown   # once
sh rust/build.sh                           # the Rust frames, into dist/native/
npm install
npm run check                              # type-checks, then writes cyclops.wings-plugin
zip -d cyclops.wings-plugin 'rust/*'       # the package would carry rust/ and its build folder otherwise
```

Drop `cyclops.wings-plugin` on the Wings window, or pick it under Plugins, Choose a file, then turn it on in Plugins.

## Release

Bump `version` in `wings-plugin.json`, commit, and push a matching tag like `v0.3.0`. The workflow builds the plugin, packs it, and attaches `cyclops.wings-plugin` to a GitHub release.
