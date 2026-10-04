/**
 * The wire format of the simulator's HTTP API. Types only: the server maps the
 * simulator onto these shapes, and the browser app knows nothing else about it.
 */

export type AccessoryKind = "light" | "blinds";

export interface Accessory {
  id: string;
  kind: AccessoryKind;
  description: string;
}

export interface Room {
  id: string;
  name: string;
  accessories: Accessory[];
}

/** Rooms with no wall between them. They share one motion timer. */
export interface Space {
  id: string;
  name: string;
  /** Room ids. */
  rooms: string[];
}

export interface HouseSummary {
  /** The house's folder name under houses/. */
  id: string;
  name: string;
  description?: string;
}

export interface House extends HouseSummary {
  motionTimeoutMinutes: number;
  rules: string[];
  rooms: Room[];
  spaces: Space[];
  /** The levels each kind of accessory can be set to. The first is its resting level. */
  levels: Record<AccessoryKind, string[]>;
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

/** An event a client can fire. */
export type TriggerEvent =
  | { type: "motion" | "button"; room: string }
  | { type: "sleep" | "wake" | "leave" | "arrive" };

/** Any event that can appear in results; motion timeouts are raised by the simulator itself. */
export type TimelineEvent = TriggerEvent | { type: "motion_timeout"; zone: string };

export interface Change {
  /** "room.accessory" */
  key: string;
  from: string;
  to: string;
  probability: number;
}

export interface Decision {
  /** "room.accessory" */
  key: string;
  /** The option Jev picked: a level name or "no_change". */
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface EventResult {
  /** "HH:MM" on the simulated clock when the event fired. */
  time: string;
  event: TimelineEvent;
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

export interface PendingTimeout {
  /** The id of an open space, or of a room that is not part of one. */
  zone: string;
  /** "HH:MM" */
  dueTime: string;
  minutesLeft: number;
}

export interface HouseState {
  /** "HH:MM" on the simulated clock. */
  time: string;
  mode: HouseMode;
  /** Keyed by "room.accessory". */
  accessories: Record<string, AccessoryState>;
  timeouts: PendingTimeout[];
}

export interface SessionStart {
  /** "HH:MM" */
  time: string;
  asleep: boolean;
  away: boolean;
}

export interface CreateSessionRequest {
  /** A house id from the house list. */
  house: string;
  start: SessionStart;
}

export interface Session {
  id: string;
  house: House;
  start: SessionStart;
  state: HouseState;
}

export interface AdvanceRequest {
  minutes: number;
}

/** The outcome of firing an event or advancing the clock. */
export interface StepResponse {
  results: EventResult[];
  state: HouseState;
}

export interface ApiError {
  error: string;
}
