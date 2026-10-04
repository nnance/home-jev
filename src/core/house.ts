import type { HouseConfig, RoomConfig, SpaceConfig } from "./types.js";

/**
 * The area that shares one motion timer: an open space, or a single room that
 * is not part of one.
 */
export interface Zone {
  id: string;
  name: string;
  rooms: RoomConfig[];
  space: SpaceConfig | null;
}

export function spaceOf(house: HouseConfig, roomId: string): SpaceConfig | null {
  return house.spaces?.find((space) => space.rooms.includes(roomId)) ?? null;
}

export function zoneOfRoom(house: HouseConfig, roomId: string): Zone {
  const space = spaceOf(house, roomId);
  if (space) return findZone(house, space.id);
  return findZone(house, roomId);
}

export function findZone(house: HouseConfig, zoneId: string): Zone {
  const space = house.spaces?.find((s) => s.id === zoneId);
  if (space) {
    const rooms = house.rooms.filter((room) => space.rooms.includes(room.id));
    return { id: space.id, name: space.name, rooms, space };
  }
  const room = house.rooms.find((r) => r.id === zoneId);
  if (!room) throw new Error(`Unknown room or space "${zoneId}"`);
  return { id: room.id, name: room.name, rooms: [room], space: null };
}

export function validateHouse(house: HouseConfig): void {
  const roomIds = new Set(house.rooms.map((room) => room.id));
  const claimed = new Map<string, string>();
  for (const space of house.spaces ?? []) {
    if (roomIds.has(space.id)) throw new Error(`Space id "${space.id}" is also a room id`);
    for (const roomId of space.rooms) {
      if (!roomIds.has(roomId)) throw new Error(`Space "${space.id}" lists unknown room "${roomId}"`);
      const other = claimed.get(roomId);
      if (other) throw new Error(`Room "${roomId}" is in both space "${other}" and space "${space.id}"`);
      claimed.set(roomId, space.id);
    }
  }
}
