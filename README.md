# Cyclops for Wings

Adds a clock button to the Wings title bar that opens the Cyclops time tracker in a popover. Sign in with Google there once and it remembers you.

## Install

Make the package and drop it on the Wings window, or pick it under Plugins, Choose a file:

```sh
git archive --format=zip --output cyclops.wings-plugin HEAD
```

Then turn it on in Plugins.

## Release

Bump `version` in `wings-plugin.json`, commit, and push a matching tag like `v0.2.0`. The workflow attaches `cyclops.wings-plugin` to a GitHub release.
