# Features

What the simulator does, and the guarantees it keeps. For setup and file formats see [README.md](README.md).

## Natural language rules

- The house's behaviour is defined by a list of plain-English rules. Changing behaviour means editing a rule, not code.
- Rules are applied by Jev; nothing in the code knows what any individual rule says.

**Invariants**

- Every decision sees the full rule list, the event, the house mode, the open spaces, and the current level of every accessory.
- An accessory can only ever be set to a level defined for its kind. Jev chooses from a fixed list and cannot invent a value.

## Events

- Room events: motion detected, wall button pressed.
- House events: goes to sleep, wakes up, everyone leaves, someone arrives.
- Motion timeout: raised by the simulator itself when a room has been quiet for the configured time.

**Invariants**

- House mode (asleep, away) is updated by code before Jev is asked, so decisions always see the new mode.
- An event naming a room that does not exist is an error, not a silent no-op.

## Open spaces

- Rooms with no wall between them can be grouped into an open space, such as a kitchen, entry, dining room and living room that form one area.
- What an open space means for behaviour is defined by the rules, not by code. Rules can make some events span the whole space (motion) and keep others local to a room (a wall button).
- For every accessory, Jev is told whether it is in the room where the event happened and whether it is in the same open space.
- On a wall button press, Jev is told whether any light is on in the room and, separately, whether any is on in its open space, so rules can make the button act on either.

**Invariants**

- A room belongs to at most one open space. A space that names an unknown room, or a room in two spaces, is an error.
- A room that is in no space behaves exactly as a house without spaces would.
- Rooms in an open space share one motion timer. Motion in any of them restarts it, and it times out once for the whole space.

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

- Each standalone room, and each open space, has a motion timer. When it expires, a motion timeout event is evaluated against the rules like any other event, so the rules decide what turns off.

**Invariants**

- Time only moves when a scenario says so; nothing depends on the real clock.
- Each motion event restarts the timer of the room it happened in, or of that room's open space. A room or space has at most one timer.
- Timers fire at their exact due time, in due order, as the clock advances past them.
- If nothing in the room or space was turned on by motion when the timer expires, the timeout is handled in code and Jev is not called.

## Knowing what turned each accessory on

- The simulator records whether each accessory was switched on by motion, by the wall button, or by a house-level event. Rules can use this, for example to turn off only motion-triggered lights on timeout.

**Invariants**

- The source is recorded when an accessory leaves its resting level (off, or closed for blinds).
- Changing the level of an accessory that is already on keeps its original source.
- Returning to the resting level clears the source.

## Multiple houses

- The project holds several houses, each with its own rooms, rules and scenarios. One run verifies all of them, or a single house or scenario can be selected.
- Houses can share a layout and differ only in rules, which verifies that behaviour really is controlled by the rules.

**Invariants**

- A scenario always runs against the house whose folder it lives in.
- Nothing is shared between houses: rules, rooms, spaces and timeout all come from that house's own definition.
- Adding a house needs no code change.

## Scenarios and expectations

- A scenario sets a start time, house mode and initial levels, then replays a sequence of waits and events.
- Any step can list expected accessory levels, checked after that step completes.
- The run prints a timeline of events, changes and probabilities, with a pass or fail line per expectation, a result per house, and a summary of requests and tokens used.

**Invariants**

- Every scenario starts from a fresh house; scenarios never affect each other.
- Accessories not mentioned in a scenario's start begin at their resting level.
- Within a step the order is always: wait, then event, then expectations.
- The process exits non-zero if any expectation fails.

## Repeated runs and request reporting

- The whole selection can be run several times in a row, to expose decisions that are borderline and only fail intermittently. The test command runs every house three times.
- Each run reports the time spent waiting on Jev, the slowest request, and the number of retries.

**Invariants**

- Requests are sent one at a time; the simulator never calls Jev concurrently.
- A retry after a rate limit or overload is always reported, never silent.
- A repeated run fails overall if any single run has a failed expectation.
