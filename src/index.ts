import { pathToFileURL } from "node:url";
import type { StateObject } from "./types.js";

const DEFAULT_STATE: StateObject = {
  house: {
    rooms: [
      {
        name: "Kitchen",
        accessories: [
          { name: "can", description: "overhead dimmable can lights", state: 0 },
          { name: "pendant", description: "overhead dimmable pendant lights", state: 0 },
          { name: "blinds", description: "0 is closed and 1 is open", state: 0 },
          { name: "undercounter", description: "under counter dimmable strip lighting", state: 0 },
          { name: "motion detector", description: "detects motion in the room", state: 0 },
        ],
      },
    ],
    state: { asleep: true, isaway: false },
    rules: [
      "When the house is asleep use soft indirect lighting when possible",
      "Only can lights and undercounter lights should come on when motion is detected",
      "Can lights should never be brighter than 60%",
    ],
    event: { room: "kitchen", type: "motion detected" },
  },
  time: "20:32:00",
};

export async function runSystemOne(state: StateObject): Promise<unknown> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }

  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state,
      model: "jev-latest",
      questions: {
        action: {
          type: "choice",
          instructions: "Should an action be taken and if so which one?",
          criteria: {
            none: "No action needed",
            set_accessory: "Set the recommended value of an accessory in a room",
          },
        },
        which_room: {
          type: "choice",
          instructions: "Select the room to take action on",
          criteria: {
            none: "no room",
            kitchen: "kitchen",
            living: "living room",
            entry: "entry way",
          },
        },
        which_accessory: {
          type: "choice",
          instructions: "Following the rules of the house and based on the current state of the house, select the accessory to take action on",
          criteria: {
            none: "no accessory",
            can: "overhead dimmable can lights",
            pendent: "overhead dimmable pendant lights",
            blinds: "powered blinds",
            undercounter: "indirect dimmable strip lighting",
          },
        },
        recommend_value: {
          type: "choice",
          instructions: "Recommend the value to set the accessory to if action is needed",
          criteria: {
            null: "no change",
            "0%": "the light is off or the blind is closed",
            "30%": "soft lighting or slightly open blind",
            "60%": "standard lighting or mostly open blind",
            "100%": "full lighting or fully open blind",
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  try {
    console.log(JSON.stringify(await runSystemOne(DEFAULT_STATE), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
