# Cyclops for Wings

Adds a clock button to the Wings title bar that opens Cyclops in the right sidebar. Start and stop timers, resume, edit and delete entries and running timers, and see each day's and week's totals. While a timer runs, the button shows how long.

Point at the clock button, or tab to it, and a popover shows today: running timers with Stop, a form that starts a timer or, under Manual, adds an entry for today from a start and an end time, today's total, and today's entries to resume, edit or delete. Open Cyclops in the popover, or a click on the button, opens the sidebar for other days and weeks. The popover needs a Wings version with plugin popovers; older ones show only the sidebar.

The arrows above the entries move a week back or forward, and each day's button shows that day's entries and total. Today brings you back. Week lists every day of the week with its entries and total, like the Cyclops web app. This week reloads every minute, and an earlier week loads once, when you first go to it.

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

Make the package and drop it on the Wings window, or pick it under Plugins, Choose a file:

```sh
git archive --format=zip --output cyclops.wings-plugin HEAD
```

Then turn it on in Plugins.

## Release

Bump `version` in `wings-plugin.json`, commit, and push a matching tag like `v0.3.0`. The workflow attaches `cyclops.wings-plugin` to a GitHub release.
