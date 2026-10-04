import type { House, TimelineEvent } from "../contract/index.js";

export function minutesLabel(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** The name of an open space, or of a room that is not part of one. */
function zoneName(house: House, zone: string): string {
  return house.spaces.find((s) => s.id === zone)?.name ?? house.rooms.find((r) => r.id === zone)?.name ?? zone;
}

export function describe(house: House, event: TimelineEvent): string {
  const room = "room" in event ? (house.rooms.find((r) => r.id === event.room)?.name ?? event.room) : "";
  switch (event.type) {
    case "motion":
      return `Motion detected in ${room}`;
    case "button":
      return `Wall button pressed in ${room}`;
    case "motion_timeout":
      return `No motion in ${zoneName(house, event.zone)} for ${minutesLabel(house.motionTimeoutMinutes)}`;
    case "sleep":
      return "House goes to sleep";
    case "wake":
      return "House wakes up";
    case "leave":
      return "Everyone leaves";
    case "arrive":
      return "Someone arrives home";
  }
}

/** The icon for an event, named after the symbols in index.html. */
export function iconOf(event: TimelineEvent): string {
  return event.type === "motion_timeout" ? "timer" : event.type;
}
