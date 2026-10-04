export type AccessoryKind = "light" | "blinds";

export interface AccessoryConfig {
  id: string;
  kind: AccessoryKind;
  description: string;
}

export interface RoomConfig {
  id: string;
  name: string;
  accessories: AccessoryConfig[];
}

/** Rooms with no wall between them, which the rules can treat as one area. */
export interface SpaceConfig {
  id: string;
  name: string;
  /** Room ids. A room can belong to at most one space. */
  rooms: string[];
}

export interface HouseConfig {
  name?: string;
  description?: string;
  /** Minutes without motion before a room's or open space's motion timeout event fires. */
  motionTimeoutMinutes: number;
  rules: string[];
  rooms: RoomConfig[];
  spaces?: SpaceConfig[];
}

/** What caused an accessory to leave its resting level. */
export type Source = "motion" | "button" | "automation";

export interface AccessoryState {
  level: string;
  turnedOnBy: Source | null;
}

export interface HouseMode {
  asleep: boolean;
  away: boolean;
}

export type SimEvent =
  | { type: "motion"; room: string }
  | { type: "button"; room: string }
  /** `zone` is the id of an open space, or of a room that is not part of one. */
  | { type: "motion_timeout"; zone: string }
  | { type: "sleep" | "wake" | "leave" | "arrive" };

/** Everything Jev needs to know about the house at the moment of an event. */
export interface Snapshot {
  house: HouseConfig;
  mode: HouseMode;
  /** Minutes since midnight. */
  minutes: number;
  /** Keyed by "room.accessory". */
  accessories: ReadonlyMap<string, AccessoryState>;
}

export interface Decision {
  /** "room.accessory" */
  key: string;
  /** The option Jev picked: a level name or "no_change". */
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface DecideResult {
  decisions: Decision[];
  inputTokens: number;
  /** Wall-clock time for the request, including any retries. */
  ms: number;
  /** Times the SDK retried after a rate limit, overload, or connection error. */
  retries: number;
}

export type Decide = (snapshot: Snapshot, event: SimEvent) => Promise<DecideResult>;

export interface Change {
  key: string;
  from: string;
  to: string;
  probability: number;
}

export interface EventResult {
  minutes: number;
  event: SimEvent;
  changes: Change[];
  /** Changes Jev leaned towards but not strongly enough to act on. */
  uncertain: Change[];
  decisions: Decision[];
  /** Set when code handled the event without asking Jev. */
  skipped?: string;
  inputTokens: number;
  ms: number;
  retries: number;
}

/** A level name, "on" (anything but the resting level), or a list of acceptable levels. */
export type Expectation = string | string[];

export interface ScenarioStep {
  /** Minutes to advance the clock before the event; due timers fire on the way. */
  wait?: number;
  event?: SimEvent;
  /** Keyed by "room.accessory", checked after the step completes. */
  expect?: Record<string, Expectation>;
}

export interface Scenario {
  name: string;
  description?: string;
  start: {
    /** "HH:MM" */
    time: string;
    asleep?: boolean;
    away?: boolean;
    /** Initial levels keyed by "room.accessory"; anything omitted starts at rest. */
    levels?: Record<string, string | AccessoryState>;
  };
  steps: ScenarioStep[];
}
