import { findZone, validateHouse, zoneOfRoom } from "./house.js";
import { NO_CHANGE, restingLevel } from "./jev.js";
import type {
  AccessoryKind,
  AccessoryState,
  Change,
  Decide,
  EventResult,
  HouseConfig,
  HouseMode,
  Scenario,
  SimEvent,
  Snapshot,
  Source,
} from "./types.js";

/** Jev must give its pick at least this probability before the simulator acts on it. */
const ACT_THRESHOLD = 0.6;

function parseTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Invalid time "${time}", expected HH:MM`);
  }
  return hours * 60 + minutes;
}

function sourceOf(event: SimEvent): Source {
  if (event.type === "motion") return "motion";
  if (event.type === "button") return "button";
  return "automation";
}

export class Simulator {
  minutes: number;
  readonly mode: HouseMode;
  readonly accessories = new Map<string, AccessoryState>();
  private readonly kinds = new Map<string, AccessoryKind>();
  /** Zone id (open space, or standalone room) to the minute its motion timeout is due. */
  private readonly motionTimers = new Map<string, number>();

  constructor(
    readonly house: HouseConfig,
    private readonly decide: Decide,
    start: Scenario["start"],
  ) {
    validateHouse(house);
    this.minutes = parseTime(start.time);
    this.mode = { asleep: start.asleep ?? false, away: start.away ?? false };

    for (const room of house.rooms) {
      for (const a of room.accessories) {
        this.kinds.set(`${room.id}.${a.id}`, a.kind);
        this.accessories.set(`${room.id}.${a.id}`, { level: restingLevel(a.kind), turnedOnBy: null });
      }
    }
    for (const [key, initial] of Object.entries(start.levels ?? {})) {
      const kind = this.kindOf(key);
      const state = typeof initial === "string" ? { level: initial, turnedOnBy: "button" as const } : initial;
      this.accessories.set(key, state.level === restingLevel(kind) ? { level: state.level, turnedOnBy: null } : state);
    }
  }

  kindOf(key: string): AccessoryKind {
    const kind = this.kinds.get(key);
    if (!kind) throw new Error(`Unknown accessory "${key}"`);
    return kind;
  }

  private snapshot(): Snapshot {
    return { house: this.house, mode: this.mode, minutes: this.minutes, accessories: this.accessories };
  }

  /** Advance the clock, firing any motion timeouts that come due on the way. */
  async advance(minutes: number): Promise<EventResult[]> {
    const target = this.minutes + minutes;
    const results: EventResult[] = [];
    for (;;) {
      const due = [...this.motionTimers].filter(([, at]) => at <= target).sort((a, b) => a[1] - b[1])[0];
      if (!due) break;
      this.minutes = due[1];
      results.push(await this.fire({ type: "motion_timeout", zone: due[0] }));
    }
    this.minutes = target;
    return results;
  }

  async fire(event: SimEvent): Promise<EventResult> {
    const result: EventResult = {
      minutes: this.minutes,
      event,
      changes: [],
      uncertain: [],
      decisions: [],
      inputTokens: 0,
      ms: 0,
      retries: 0,
    };

    if ("room" in event && !this.house.rooms.some((room) => room.id === event.room)) {
      throw new Error(`Unknown room "${event.room}"`);
    }

    switch (event.type) {
      case "sleep":
        this.mode.asleep = true;
        break;
      case "wake":
        this.mode.asleep = false;
        break;
      case "leave":
        this.mode.away = true;
        break;
      case "arrive":
        this.mode.away = false;
        break;
      case "motion":
        // Rooms in an open space share one timer, so motion anywhere in the space keeps it alive.
        this.motionTimers.set(zoneOfRoom(this.house, event.room).id, this.minutes + this.house.motionTimeoutMinutes);
        break;
      case "motion_timeout": {
        this.motionTimers.delete(event.zone);
        const litByMotion = findZone(this.house, event.zone).rooms.some((room) =>
          room.accessories.some((a) => this.accessories.get(`${room.id}.${a.id}`)?.turnedOnBy === "motion"),
        );
        if (!litByMotion) {
          result.skipped = "nothing there was turned on by motion";
          return result;
        }
        break;
      }
    }

    const { decisions, inputTokens, ms, retries } = await this.decide(this.snapshot(), event);
    result.decisions = decisions;
    result.inputTokens = inputTokens;
    result.ms = ms;
    result.retries = retries;

    // Decisions were all made against the same snapshot, so apply them together afterwards.
    for (const decision of decisions) {
      const current = this.accessories.get(decision.key);
      if (!current || decision.choice === NO_CHANGE || decision.choice === current.level) continue;

      const change: Change = {
        key: decision.key,
        from: current.level,
        to: decision.choice,
        probability: decision.probabilities[decision.choice] ?? 0,
      };
      if (change.probability < ACT_THRESHOLD) {
        result.uncertain.push(change);
        continue;
      }

      const resting = restingLevel(this.kindOf(decision.key));
      let turnedOnBy = current.turnedOnBy;
      if (change.to === resting) turnedOnBy = null;
      else if (current.level === resting) turnedOnBy = sourceOf(event);
      this.accessories.set(decision.key, { level: change.to, turnedOnBy });
      result.changes.push(change);
    }

    return result;
  }
}
