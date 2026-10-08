# Cyclops for Wings

Adds a clock button to the Wings title bar that opens Cyclops in the right sidebar. Start and stop timers, resume today's entries, and see today's and this week's totals. While a timer runs, the button shows how long.

## Connect

The sidebar asks for a personal API token. Make one in Cyclops under Settings, API tokens (the sidebar has a button that opens it), and paste it in. Wings keeps it in your keychain and adds it to requests itself, so the plugin's code never holds it. Sign out removes it from this Mac. Revoke it in Cyclops Settings to stop it working anywhere.

## Claude

With Wings connected to Claude Code (Plugins, Claude Code, Connect), Claude gets four tools: `cyclops__list_projects`, `cyclops__running_timers`, `cyclops__start_timer` and `cyclops__stop_timer`. They use the same token, so connect the sidebar first.

## Install

Make the package and drop it on the Wings window, or pick it under Plugins, Choose a file:

```sh
git archive --format=zip --output cyclops.wings-plugin HEAD
```

Then turn it on in Plugins.

## Release

Bump `version` in `wings-plugin.json`, commit, and push a matching tag like `v0.3.0`. The workflow attaches `cyclops.wings-plugin` to a GitHub release.
