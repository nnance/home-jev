# home-jev

A home automation simulator where the house's behaviour is written as plain-English rules, and [Jev](https://docs.typesafe.ai) (TypeSafe's System One model) decides what each light and blind should do when something happens.

You describe a house, a list of rules such as "when motion is detected while the house is asleep, turn on only the indirect lights, at soft", and a set of scenarios. The project holds several houses, each with its own rules and scenarios, and a run verifies all of them. The simulator replays each scenario, asks Jev how to respond to every event, applies the resulting commands, and checks the house against the outcomes you expected.

See [FEATURES.md](FEATURES.md) for what the simulator does and the guarantees it keeps.

## How it works

When an event fires (motion, a wall button press, the house going to sleep, and so on), the simulator sends Jev a single request containing:

- the event,
- the house mode (asleep, away) and time of day,
- the rules,
- the current level of every accessory,
- one question per accessory: leave it alone, or set it to which level?

Jev answers all the questions in parallel, so one event can produce a command for every accessory in the house. Code then applies the commands.

Code, not Jev, owns the clock, the motion timers, and the record of what turned each light on. Jev only makes the judgment call of applying the rules to the current situation.

## Setup

Requires Node.js 20 or newer and a TypeSafe API key.

```sh
npm install
echo "TYPESAFE_API_KEY=your-key-here" > .env
```

## Running

```sh
npm run build

npm start                                             # every scenario of every house
npm start -- houses/open-plan                         # every scenario of one house
npm start -- houses/open-plan/scenarios/button.json   # one scenario
npm start -- --verbose                                # also print Jev's probabilities for every accessory
npm start -- --runs 5 --quiet                         # repeat the selection; print only failures and summaries

npm test                                              # build, then run every house 3 times, quietly
```

Jev's answers can vary slightly between identical requests, so a borderline decision shows up as a failure in some runs and not others. `npm test` repeats the whole suite three times to catch that, and exits non-zero if any run has a failure.

Requests are sent one at a time. The summary reports how long was spent waiting on Jev, the slowest request, and how many times the SDK had to retry after a rate limit or overload; each retry is also printed as it happens.

Run it from the project root; `houses/` is read relative to the current directory.

Each run prints a timeline per scenario, a result per house, and a summary:

```
=== Open plan  (houses/open-plan) ===

Motion while asleep  (starts 02:15, asleep, home)
  [02:15] motion detected in Entry
      entry.baseboard          off -> soft  (p=1.00)
      PASS entry.baseboard is soft
      PASS entry.ceiling is off
  ... 5 minutes pass
  [02:20] no motion in Entry for 5 minutes
      entry.baseboard          soft -> off  (p=0.99)

Open plan: 89 passed, 0 failed

139 expectations passed, 0 failed across 12 scenarios in 3 houses
39 Jev requests, 188154 input tokens, 0 retries, 6.6s waiting on Jev (slowest request 252ms)
```

The process exits non-zero if any expectation fails.

## Houses

Each folder under `houses/` is a self-contained house: a `house.json` and a `scenarios/` folder that verifies it. A different house can have different rooms, different rules, or both.

| House | What it verifies |
| --- | --- |
| `open-plan` | Kitchen, entry, dining and living room form one open space. Motion lights the whole space; wall buttons stay room-local. |
| `open-plan-space-button` | The same rooms with different button rules: a button in the open space toggles the whole space. Shows that behaviour changes by editing rules alone. |
| `apartment` | Walls between every room and no open spaces, with a longer timeout and rules where motion does nothing at night. |

To add a house, create `houses/<name>/house.json` and `houses/<name>/scenarios/`; it is picked up on the next run.

## Configuring a house

`house.json` defines the motion timeout, the open spaces, the rules, and the rooms:

```json
{
  "name": "Open plan",
  "motionTimeoutMinutes": 5,
  "spaces": [{ "id": "main", "name": "Main Floor", "rooms": ["kitchen", "entry", "dining", "living"] }],
  "rules": ["When everyone leaves, turn off every light in every room."],
  "rooms": [
    {
      "id": "kitchen",
      "name": "Kitchen",
      "accessories": [
        { "id": "can", "kind": "light", "description": "main overhead can lights" },
        { "id": "blinds", "kind": "blinds", "description": "powered window blinds" }
      ]
    }
  ]
}
```

Accessory kinds and their levels:

| Kind | Levels |
| --- | --- |
| `light` | `off`, `soft`, `standard`, `full` |
| `blinds` | `closed`, `open` |

### Open spaces

Rooms with no wall between them can be grouped into an open space under `spaces`. A room can belong to at most one space, and `spaces` can be omitted entirely.

Grouping rooms does two things:

- Jev is told which rooms share an open space, so rules can refer to it. How the space behaves is up to your rules. The included rules make motion in any room light the whole space, while a wall button still only controls its own room:

  ```
  When motion is detected and the house is awake, turn on the main overhead lights at standard
  in the room with the motion and in every other room of the same open space.

  The wall button only ever changes lights in its own room, even when that room is part of an open space.
  ```

- The rooms share one motion timer. Motion anywhere in the space keeps the whole space alive, and the timeout fires once for the space, not per room.

Rules refer to accessories by what their `description` says (for example "main overhead" or "indirect"), so keep descriptions and rules in the same vocabulary. Give every event an explicit rule, even if the rule is "change nothing"; an event no rule covers leaves Jev guessing.

## Writing scenarios

Each file in a house's `scenarios/` folder is one scenario, run against that house:

```json
{
  "name": "Mixed sources on timeout",
  "description": "Only the motion-triggered light goes off when the room goes quiet.",
  "start": { "time": "18:00", "asleep": false, "levels": { "kitchen.pendant": "standard" } },
  "steps": [
    {
      "event": { "type": "motion", "room": "kitchen" },
      "expect": { "kitchen.can": "standard", "kitchen.pendant": "standard" }
    },
    { "wait": 6, "expect": { "kitchen.can": "off", "kitchen.pendant": "standard" } }
  ]
}
```

A step can `wait` a number of minutes, fire an `event`, and check `expect`, in that order. All three are optional.

| Event | Fields |
| --- | --- |
| `motion` | `room` |
| `button` | `room` |
| `sleep`, `wake`, `leave`, `arrive` | none |

Accessories are addressed as `room.accessory`. An expectation is a level name, `"on"` (anything but the resting level), or a list of acceptable levels.

## Tech stack

- **TypeScript** on **Node.js** (ES modules), compiled with `tsc`
- **[@typesafe-ai/sdk](https://docs.typesafe.ai/sdk/javascript)** for calls to Jev (`jev-latest`)
- **Biome** for linting and formatting (`npm run lint`, `npm run format`)
- JSON files for the house definitions and scenarios; no database or server

## Project layout

```
houses/<name>/
  house.json        rooms, open spaces, accessories, rules, motion timeout
  scenarios/        one JSON file per scenario for that house
src/index.ts        CLI: loads scenarios, prints the timeline, checks expectations
src/simulator.ts    clock, motion timers, house state, applying Jev's decisions
src/jev.ts          builds the state and questions sent to Jev
src/house.ts        open space lookups and house validation
src/types.ts        shared types
```
