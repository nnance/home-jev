import { type ChoiceCriteria, type ChoiceQuestion, choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { AccessoryKind, Decide, Decision, RoomConfig, SimEvent, Snapshot } from "./types.js";

export const NO_CHANGE = "no_change";

/** The levels each kind of accessory can be set to. The first is its resting level. */
export const LEVELS: Record<AccessoryKind, Record<string, string>> = {
  light: {
    off: "The light is off",
    soft: "Dim, gentle lighting (30%)",
    standard: "Normal everyday lighting (60%)",
    full: "Maximum brightness (100%)",
  },
  blinds: {
    closed: "The blinds are closed",
    open: "The blinds are open",
  },
};

export function restingLevel(kind: AccessoryKind): string {
  return Object.keys(LEVELS[kind])[0] as string;
}

export function formatTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

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
    case "motion":
      return { type: "motion detected", room: roomName(snapshot, event.room) };
    case "button": {
      const room = snapshot.house.rooms.find((r) => r.id === event.room);
      const on = room ? lightsOn(snapshot, room) : [];
      return {
        type: "wall button pressed",
        room: roomName(snapshot, event.room),
        room_lights_before_press: on.length > 0 ? "at least one light is on" : "all lights are off",
      };
    }
    case "motion_timeout":
      return {
        type: "motion timeout",
        room: roomName(snapshot, event.room),
        description: `No motion has been detected in this room for ${snapshot.house.motionTimeoutMinutes} minutes`,
      };
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
    rooms: house.rooms.map((room) => ({
      name: room.name,
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
    for (const a of room.accessories) {
      const current = accessories.get(`${room.id}.${a.id}`);
      questions[`${room.id}.${a.id}`] = choice(
        {
          accessory: {
            room: room.name,
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

export function createDecide(client = new TypeSafeClient()): Decide {
  return async (snapshot, event) => {
    const response = await client.systemOne(buildRequest(snapshot, event));
    const decisions: Decision[] = Object.entries(response.answers).map(([key, answer]) => ({
      key,
      choice: answer.choice,
      probabilities: { ...answer.probabilities },
      confidence: answer.confidence,
    }));
    return { decisions, inputTokens: response.usage.input_tokens };
  };
}
