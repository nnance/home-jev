import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HouseConfig } from "../core/types.js";

const HOUSE_FILE = "house.json";

/** The ids of the houses in a directory: its sub-folders, in name order. */
export async function listHouseIds(housesDir: string): Promise<string[]> {
  const entries = await readdir(housesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Reads the house defined in a house folder. */
export async function readHouse(houseDir: string): Promise<HouseConfig> {
  return JSON.parse(await readFile(join(houseDir, HOUSE_FILE), "utf8")) as HouseConfig;
}

/** Returns null for an id that is not a house, so an id can never name a path outside the directory. */
export async function loadHouse(housesDir: string, id: string): Promise<HouseConfig | null> {
  if (!(await listHouseIds(housesDir)).includes(id)) return null;
  return readHouse(join(housesDir, id));
}
