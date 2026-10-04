import { type ChoiceCriteria, type ChoiceQuestion, choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { findZone, spaceOf } from "../core/house.js";
import { LEVELS, NO_CHANGE } from "../core/levels.js";
import { formatTime } from "../core/time.js";
import type { Decide, HouseConfig, RoomConfig, SimEvent, Snapshot } from "../core/types.js";

/** What one request to Jev cost. */
export interface JevUsage {
  inputTokens: number;
  /** Wall-clock time for the request, including any retries. */
  ms: number;
  /** Times the SDK retried after a rate limit, overload, or connection error. */
  retries: number;
}

/** Given a listener for each request's cost, returns a Decide. The shape of createDecide, so tests can stand in for it. */
export type ConnectDecide = (onUsage: (usage: JevUsage) => void) => Decide;

// Jev reads times as text, so code names the part of the day for it.
function timeOfDay(minutes: number): string {
  const hour = Math.floor((((minutes % 1440) + 1440) % 1440) / 60);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function roomName(snapshot: Snapshot, roomId: string): string {
  return snapshot.house.rooms.find((room) => room.id === roomId)?.name ?? roomId;
}

function lightsOn(snapshot: Snapshot, room: RoomConfig): string[] {
  return room.accessories
    .filter((a) => a.kind === "light" && snapshot.accessories.get(`${room.id}.${a.id}`)?.level !== "off")
    .map((a) => a.id);
}

function describeEvent(snapshot: Snapshot, event: SimEvent) {
  switch (event.type) {
    case "motion": {
      const space = spaceOf(snapshot.house, event.room);
      return {
        type: "motion detected",
        room: roomName(snapshot, event.room),
        ...(space && { open_space: space.name }),
      };
    }
    case "button": {
      const room = snapshot.house.rooms.find((r) => r.id === event.room);
      const space = spaceOf(snapshot.house, event.room);
      const anyOn = (rooms: RoomConfig[]) =>
        rooms.some((r) => lightsOn(snapshot, r).length > 0) ? "at least one light is on" : "all lights are off";
      return {
        type: "wall button pressed",
        room: roomName(snapshot, event.room),
        room_lights_before_press: anyOn(room ? [room] : []),
        // Both facts are given so rules can make the button act on its room or on the whole space.
        ...(space && {
          open_space: space.name,
          open_space_lights_before_press: anyOn(findZone(snapshot.house, space.id).rooms),
        }),
      };
    }
    case "motion_timeout": {
      const zone = findZone(snapshot.house, event.zone);
      const minutes = snapshot.house.motionTimeoutMinutes;
      if (zone.space) {
        return {
          type: "motion timeout",
          open_space: zone.name,
          description: `No motion has been detected in any room of this open space for ${minutes} minutes`,
        };
      }
      return {
        type: "motion timeout",
        room: zone.name,
        description: `No motion has been detected in this room for ${minutes} minutes`,
      };
    }
    case "sleep":
      return { type: "house went to sleep", description: "The household has gone to bed" };
    case "wake":
      return { type: "house woke up", description: "The household has got up for the day" };
    case "leave":
      return { type: "house became empty", description: "Everyone has left the house" };
    case "arrive":
      return { type: "someone arrived home", description: "The house is no longer empty" };
  }
}

// Where a room sits relative to the event, worked out in code so Jev does not
// have to look up open space membership itself.
function locate(house: HouseConfig, event: SimEvent, room: RoomConfig) {
  if (event.type === "motion" || event.type === "button") {
    const space = spaceOf(house, event.room);
    return {
      in_event_room: room.id === event.room,
      in_event_open_space: space?.rooms.includes(room.id) ?? false,
    };
  }
  if (event.type === "motion_timeout") {
    const zone = findZone(house, event.zone);
    const inZone = zone.rooms.some((r) => r.id === room.id);
    return { in_event_room: inZone && !zone.space, in_event_open_space: inZone && zone.space !== null };
  }
  return {};
}

export function buildRequest(snapshot: Snapshot, event: SimEvent) {
  const { house, mode, minutes, accessories } = snapshot;

  const state = {
    event: describeEvent(snapshot, event),
    house: {
      asleep: mode.asleep,
      away: mode.away,
      time: formatTime(minutes),
      time_of_day: timeOfDay(minutes),
    },
    rules: house.rules,
    open_spaces: (house.spaces ?? []).map((space) => ({
      name: space.name,
      rooms: space.rooms.map((roomId) => roomName(snapshot, roomId)),
    })),
    rooms: house.rooms.map((room) => ({
      name: room.name,
      open_space: spaceOf(house, room.id)?.name ?? "none",
      accessories: room.accessories.map((a) => {
        const current = accessories.get(`${room.id}.${a.id}`);
        return {
          name: a.id,
          description: a.description,
          level: current?.level ?? null,
          turned_on_by: current?.turnedOnBy ?? "nothing",
        };
      }),
    })),
  };

  // One question per accessory. Jev answers them in parallel in a single request,
  // so one event can produce a command for every accessory in the house.
  const questions: Record<string, ChoiceQuestion<ChoiceCriteria>> = {};
  for (const room of house.rooms) {
    const location = locate(house, event, room);
    for (const a of room.accessories) {
      const current = accessories.get(`${room.id}.${a.id}`);
      questions[`${room.id}.${a.id}`] = choice(
        {
          accessory: {
            room: room.name,
            ...location,
            name: a.id,
            description: a.description,
            current_level: current?.level ?? null,
            turned_on_by: current?.turnedOnBy ?? "nothing",
          },
          question:
            "The event in `event` has just happened. Following `rules`, and given `house` and the current levels in `rooms`, what should `accessory` be set to in response?",
        },
        {
          [NO_CHANGE]:
            "Leave the accessory exactly as it is. No rule calls for changing this accessory in response to this event.",
          ...LEVELS[a.kind],
        },
      );
    }
  }

  return { state, questions };
}

/** The Jev adapter for the simulator's Decide port. Reports what each request cost to `onUsage`. */
export const createDecide: ConnectDecide = (onUsage) => {
  // The SDK retries rate limits and overloads on its own and only mentions it at
  // info level, so listen there to count retries instead of letting them pass silently.
  let retries = 0;
  const client = new TypeSafeClient({
    logLevel: "info",
    logger: {
      debug: () => {},
      info: (message) => {
        if (!message.includes("retrying")) return;
        retries += 1;
        console.error(`      ${message}`);
      },
      warn: (message, ...args) => console.warn(message, ...args),
      error: (message, ...args) => console.error(message, ...args),
    },
  });

  return async (snapshot, event) => {
    const retriesBefore = retries;
    const started = performance.now();
    const response = await client.systemOne(buildRequest(snapshot, event));
    const ms = Math.round(performance.now() - started);
    onUsage({ inputTokens: response.usage.input_tokens, ms, retries: retries - retriesBefore });
    return Object.entries(response.answers).map(([key, answer]) => ({
      key,
      choice: answer.choice,
      probabilities: { ...answer.probabilities },
      confidence: answer.confidence,
    }));
  };
};
