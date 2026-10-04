import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDecide, formatTime, NO_CHANGE, restingLevel } from "./jev.js";
import { Simulator } from "./simulator.js";
import type { EventResult, Expectation, HouseConfig, Scenario, SimEvent } from "./types.js";

const HOUSE_FILE = "house.json";
const SCENARIO_DIR = "scenarios";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function describe(house: HouseConfig, event: SimEvent): string {
  const room = "room" in event ? (house.rooms.find((r) => r.id === event.room)?.name ?? event.room) : "";
  switch (event.type) {
    case "motion":
      return `motion detected in ${room}`;
    case "button":
      return `wall button pressed in ${room}`;
    case "motion_timeout":
      return `no motion in ${room} for ${house.motionTimeoutMinutes} minutes`;
    case "sleep":
      return "house goes to sleep";
    case "wake":
      return "house wakes up";
    case "leave":
      return "everyone leaves";
    case "arrive":
      return "someone arrives home";
  }
}

function printResult(house: HouseConfig, result: EventResult, verbose: boolean): void {
  console.log(`  [${formatTime(result.minutes)}] ${describe(house, result.event)}`);
  if (result.skipped) {
    console.log(`      (not sent to Jev: ${result.skipped})`);
    return;
  }
  if (result.changes.length === 0) console.log("      no changes");
  for (const change of result.changes) {
    console.log(`      ${change.key.padEnd(24)} ${change.from} -> ${change.to}  (p=${change.probability.toFixed(2)})`);
  }
  for (const change of result.uncertain) {
    console.log(
      `      ${change.key.padEnd(24)} unsure, left at ${change.from} (leaned ${change.to}, p=${change.probability.toFixed(2)})`,
    );
  }
  if (verbose) {
    for (const decision of result.decisions) {
      const probabilities = Object.entries(decision.probabilities)
        .filter(([, p]) => p >= 0.01)
        .sort((a, b) => b[1] - a[1])
        .map(([option, p]) => `${option}=${p.toFixed(2)}`)
        .join(" ");
      const marker = decision.choice === NO_CHANGE ? " " : "*";
      console.log(`      ${marker} ${decision.key.padEnd(22)} ${probabilities}`);
    }
  }
}

function meets(expectation: Expectation, level: string, resting: string): boolean {
  if (Array.isArray(expectation)) return expectation.includes(level);
  if (expectation === "on") return level !== resting;
  return expectation === level;
}

interface Totals {
  passed: number;
  failed: number;
  requests: number;
  inputTokens: number;
}

async function runScenario(house: HouseConfig, scenario: Scenario, verbose: boolean, totals: Totals): Promise<void> {
  const simulator = new Simulator(house, createDecide(), scenario.start);
  const mode = [scenario.start.asleep ? "asleep" : "awake", scenario.start.away ? "away" : "home"].join(", ");
  console.log(`\n${scenario.name}  (starts ${scenario.start.time}, ${mode})`);
  if (scenario.description) console.log(`  ${scenario.description}`);

  for (const step of scenario.steps) {
    const results: EventResult[] = [];
    if (step.wait) {
      console.log(`  ... ${step.wait} minutes pass`);
      results.push(...(await simulator.advance(step.wait)));
    }
    if (step.event) results.push(await simulator.fire(step.event));

    for (const result of results) {
      printResult(house, result, verbose);
      if (!result.skipped) totals.requests += 1;
      totals.inputTokens += result.inputTokens;
    }

    for (const [key, expectation] of Object.entries(step.expect ?? {})) {
      const level = simulator.accessories.get(key)?.level ?? "";
      const ok = meets(expectation, level, restingLevel(simulator.kindOf(key)));
      const wanted = Array.isArray(expectation) ? expectation.join(" or ") : expectation;
      if (ok) {
        totals.passed += 1;
        console.log(`      PASS ${key} is ${level}`);
      } else {
        totals.failed += 1;
        console.log(`      FAIL ${key} is ${level}, expected ${wanted}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  let files = args.filter((arg) => !arg.startsWith("--"));
  if (files.length === 0) {
    files = (await readdir(SCENARIO_DIR))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => join(SCENARIO_DIR, name));
  }

  const house = await readJson<HouseConfig>(HOUSE_FILE);
  const totals: Totals = { passed: 0, failed: 0, requests: 0, inputTokens: 0 };
  for (const file of files) {
    await runScenario(house, await readJson<Scenario>(file), verbose, totals);
  }

  console.log(
    `\n${totals.passed} expectations passed, ${totals.failed} failed across ${files.length} scenarios ` +
      `(${totals.requests} Jev requests, ${totals.inputTokens} input tokens)`,
  );
  if (totals.failed > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
