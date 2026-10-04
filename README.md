# home-jev

A home automation simulator where the house's behaviour is written as plain-English rules, and [Jev](https://docs.typesafe.ai) (TypeSafe's System One model) decides what each light and blind should do when something happens.

You describe a house, a list of rules such as "when motion is detected while the house is asleep, turn on only the indirect lights, at soft", and a set of scenarios. The simulator replays each scenario, asks Jev how to respond to every event, applies the resulting commands, and checks the house against the outcomes you expected.

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

npm start                                # run every scenario in scenarios/
npm start -- scenarios/button.json       # run one scenario
npm start -- --verbose                   # also print Jev's probabilities for every accessory
```

Run it from the project root; `house.json` and `scenarios/` are read relative to the current directory.

Each run prints a timeline per scenario and a summary:

```
Motion while asleep  (starts 02:15, asleep, home)
  [02:15] motion detected in Entry
      entry.baseboard          off -> soft  (p=1.00)
      PASS entry.baseboard is soft
      PASS entry.ceiling is off
  ... 5 minutes pass
  [02:20] no motion in Entry for 5 minutes
      entry.baseboard          soft -> off  (p=0.99)

52 expectations passed, 0 failed across 7 scenarios (20 Jev requests, 75951 input tokens)
```

The process exits non-zero if any expectation fails.

## Configuring the house

`house.json` defines the motion timeout, the rules, and the rooms:

```json
{
  "motionTimeoutMinutes": 5,
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

Rules refer to accessories by what their `description` says (for example "main overhead" or "indirect"), so keep descriptions and rules in the same vocabulary. Give every event an explicit rule, even if the rule is "change nothing"; an event no rule covers leaves Jev guessing.

## Writing scenarios

Each file in `scenarios/` is one scenario:

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
- JSON files for the house definition and scenarios; no database or server

## Project layout

```
house.json          rooms, accessories, rules, motion timeout
scenarios/          one JSON file per scenario
src/index.ts        CLI: loads scenarios, prints the timeline, checks expectations
src/simulator.ts    clock, motion timers, house state, applying Jev's decisions
src/jev.ts          builds the state and questions sent to Jev
src/types.ts        shared types
```
