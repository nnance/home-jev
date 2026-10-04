# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A home automation simulator. A house's behaviour is written as plain-English rules in `houses/<name>/house.json`, and Jev (TypeSafe's System One model) decides what each light and blind does when an event happens. The same simulator runs under a CLI that replays scenarios and under an HTTP API that a web page drives by hand.

`README.md` covers setup, file formats and the API endpoints. `FEATURES.md` lists every feature with its invariants; treat those invariants as the spec, and update the file when behaviour changes.

## Principles

1. **Test every change end to end before calling it done.** Prefer verification through the real thing: CLI scenarios under `houses/*/scenarios/` for simulator behaviour, and the `agent-browser` CLI against the running page for web changes. Unit tests are acceptable but kept minimal, written only for functions with complex logic.
2. **Minimise external dependencies.** Any dependency added must have no transitive dependencies. For a complex problem such as a web app or an API, a single dependency with no transitive dependencies is acceptable. Check with `npm view <pkg> dependencies` before adding one.
3. **Keep well-defined seams, with deep modules behind thin APIs.** Reuse existing code instead of duplicating it. When code needs to be reused across a seam, expose it in a way that follows the existing seams rather than reaching around them.

## Commands

Run everything from the project root; `houses/` and the web assets are read relative to it. Jev calls need `TYPESAFE_API_KEY` in `.env`.

```sh
npm run build                                         # tsc -b for the Node program and the browser app
npm run lint                                          # biome lint
npm run format                                        # biome format --write

npm start                                             # every scenario of every house (calls Jev)
npm start -- houses/open-plan                         # one house
npm start -- houses/open-plan/scenarios/button.json   # one scenario
npm start -- --verbose                                # also print Jev's probabilities per accessory
npm test                                              # build, then every house 3 times, quietly

npm run test:api                                      # API tests against a stand-in for Jev; no key, no network
node --test --test-name-pattern "motion timer" "dist/server/*.test.js"   # one API test, after a build

npm run web                                           # build, then serve page and API at http://localhost:3000
```

`npm start` runs the compiled output without building, so run `npm run build` first after changing source. `npm test`, `npm run test:api` and `npm run web` build for you.

Jev's answers vary slightly between identical requests, so a borderline rule shows up as an intermittent failure. That is why `npm test` runs the suite three times; a scenario passing once is not proof.

### Verifying the web page

`agent-browser` is not a project dependency; run it with `npx -y agent-browser`. With `npm run web` running:

```sh
npx -y agent-browser open http://localhost:3000
npx -y agent-browser click "[data-control='motion:kitchen']"
npx -y agent-browser eval "document.querySelector('#clock').textContent"
npx -y agent-browser errors
```

The page exposes stable hooks for this: `data-control` on every event control (`motion:<room>`, `button:<room>`, `sleep`, `wake`, `leave`, `arrive`, `advance:1`, `advance:5`, `advance:custom`), `data-accessory` and `data-level` on each accessory row, `data-timeout` on pending-timeout pills, `data-entry` on timeline entries, plus `#clock`, `#mode`, `#house`, `#start-time` and `#restart`. Controls are disabled while a request is in flight, so wait for `[data-control]:disabled` to clear between steps. `agent-browser fill` does not set the time input reliably; set its value and dispatch an `input` event through `eval` instead.

## Architecture

Dependencies point one way only:

```
src/cli ────────┐                  ┌── Decide port ◀── src/adapters/jev ──▶ Jev
                ├──▶ src/core ─────┘
src/server ─────┘        ▲
   ▲   │                 └── src/adapters/houses (reads house.json)
   │   └──▶ src/contract ◀── src/web   (types only)
   └── HTTP + JSON ────────── src/web  (runs in the browser)
```

The simulator follows ports and adapters, and every dependency reaches it by injection.

- **`src/core/`** is the simulator and is pure: no I/O, no packages, no Node APIs, no real clock. `Simulator` is handed a `Decide` function (the port, defined in `types.ts`) and its whole operating surface is `fire(event)` and `advance(minutes)`. Code, not Jev, owns the clock, the motion timers, the house mode and the record of what turned each accessory on. The port receives a copy of the house and returns only decisions.
- **`src/adapters/`** holds what plugs in from outside. `jev.ts` implements `Decide` with Jev: one request per event with one question per accessory, and nothing in the code knows what any rule says. It reports each request's cost (tokens, time, retries) to a listener rather than through the port. `houses.ts` reads house definitions from disk for both the CLI and the server.
- **`src/cli/`** composes the core with the Jev adapter and replays scenario files, checking expectations.
- **`src/server/`** is a thin HTTP adapter. `createApp({ connect, housesDir })` returns a Hono app holding one `Simulator` per session in memory; `connect` supplies the `Decide` (the Jev adapter in `index.ts`, a stand-in in tests). Its two mutating routes map directly onto `fire` and `advance`. It maps core values onto contract types, validates requests, queues steps so Jev is never called concurrently, and pairs each request's cost with the event that caused it.
- **`src/contract/`** holds the API's request and response types and no runtime code. It is the only thing the server and the page share.
- **`src/web/`** is the Preact page. It reaches the simulator only through `/api` and imports only from `src/contract/`.

The seams are enforced, not conventional. `src/core/`, `src/contract/` and `src/web/` are separate TypeScript projects (`tsc -b . src/web`). The core compiles with no Node types and a Biome rule in `biome.json` restricts it to importing its own files, so adding an SDK, `node:` or adapter import there fails lint and the build. The page's `rootDir` makes importing anything from `src/core/` a compile error.

Do not work around these by widening `rootDir`, relaxing the lint rule or copying core logic elsewhere. If the core needs something from outside, define a port in the core and implement it in `src/adapters/`. If the page needs something new, add it to the contract and have the server supply it. If the server needs something from the core, expose it there as a narrow read-only addition (the `pendingTimeouts` getter is the model).

### Web build

There is no bundler and no CSS build step. `tsc` compiles the TSX to ES modules in `dist/web/`, which the browser loads directly; relative imports therefore need `.js` extensions. `src/web/index.html` carries the import map that resolves `preact` to files the server serves from `node_modules`, the Tailwind theme tokens, and the component classes (`.btn`, `.pill`, `.acc`, and so on). Tailwind is compiled in the page by `@tailwindcss/browser`. The server serves only the page, `dist/web/`, and those two vendor libraries.

### Things that are easy to get wrong

- All decisions for an event are made against one snapshot and applied together afterwards; a change is applied only when Jev gives its pick at least 0.6.
- Rooms in an open space share one motion timer, keyed by the space id; a standalone room's timer is keyed by its room id. "Zone" means either.
- A motion timeout is raised only by the simulator. The API rejects a client trying to fire one.
- Time is simulated everywhere. Nothing on the server or in the core reads the real clock; the page only uses the browser's time to prefill the start-time field.
- Adding a house needs no code change: create `houses/<name>/house.json` and a `scenarios/` folder. Rules refer to accessories by the wording of their `description`, and every event should have an explicit rule, even if it is "change nothing".
