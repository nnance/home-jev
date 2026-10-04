# Features

What the simulator does, and the guarantees it keeps. For setup and file formats see [README.md](README.md).

## Natural language rules

- The house's behaviour is defined by a list of plain-English rules. Changing behaviour means editing a rule, not code.
- Rules are applied by Jev; nothing in the code knows what any individual rule says.

**Invariants**

- Every decision sees the full rule list, the event, the house mode, and the current level of every accessory.
- An accessory can only ever be set to a level defined for its kind. Jev chooses from a fixed list and cannot invent a value.

## Events

- Room events: motion detected, wall button pressed.
- House events: goes to sleep, wakes up, everyone leaves, someone arrives.
- Motion timeout: raised by the simulator itself when a room has been quiet for the configured time.

**Invariants**

- House mode (asleep, away) is updated by code before Jev is asked, so decisions always see the new mode.
- An event naming a room that does not exist is an error, not a silent no-op.

## Many commands from one event

- Each event results in one request to Jev, with a separate question for every accessory in the house.
- A single event can therefore change any number of accessories at once, in any room.

**Invariants**

- All decisions for an event are made against the same snapshot of the house, then applied together. One accessory's change never influences another's decision within the same event.
- "No change" is always an available answer for every accessory.

## Acting only on confident decisions

- Every decision comes with a probability. A change is applied only when Jev gives its pick at least 0.6.
- Changes below that are left unapplied and shown in the timeline as "unsure".

**Invariants**

- A low-confidence decision never changes the house.
- A decision that matches the accessory's current level is a no-op.

## Motion timeout

- Each room has a motion timer. When it expires, a motion timeout event is evaluated against the rules like any other event, so the rules decide what turns off.

**Invariants**

- Time only moves when a scenario says so; nothing depends on the real clock.
- Each motion event in a room restarts that room's timer. A room has at most one timer.
- Timers fire at their exact due time, in due order, as the clock advances past them.
- If nothing in the room was turned on by motion when the timer expires, the timeout is handled in code and Jev is not called.

## Knowing what turned each accessory on

- The simulator records whether each accessory was switched on by motion, by the wall button, or by a house-level event. Rules can use this, for example to turn off only motion-triggered lights on timeout.

**Invariants**

- The source is recorded when an accessory leaves its resting level (off, or closed for blinds).
- Changing the level of an accessory that is already on keeps its original source.
- Returning to the resting level clears the source.

## Scenarios and expectations

- A scenario sets a start time, house mode and initial levels, then replays a sequence of waits and events.
- Any step can list expected accessory levels, checked after that step completes.
- The run prints a timeline of events, changes and probabilities, with a pass or fail line per expectation and a summary of requests and tokens used.

**Invariants**

- Every scenario starts from a fresh house; scenarios never affect each other.
- Accessories not mentioned in a scenario's start begin at their resting level.
- Within a step the order is always: wait, then event, then expectations.
- The process exits non-zero if any expectation fails.
