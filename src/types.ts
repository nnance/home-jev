export interface Accessory {
  name: "can" | "pendant" | "blinds" | "undercounter" | "motion detector";
  description: string;
  state: number;
}

export interface Room {
  name: string;
  accessories: (Accessory)[];
}

export interface HouseStatus {
  asleep: boolean;
  isaway: boolean;
}

export interface HouseEvent {
  room: string;
  type: string;
}

export interface House {
  rooms: Room[];
  state: HouseStatus;
  rules: string[];
  event: HouseEvent;
}

export interface StateObject {
  house: House;
  time: string;
}
