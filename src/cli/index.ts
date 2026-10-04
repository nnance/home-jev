import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { listHouseIds, readHouse } from "../adapters/houses.js";
import { createDecide, type JevUsage } from "../adapters/jev.js";
import { findZone } from "../core/house.js";
import { NO_CHANGE, restingLevel } from "../core/levels.js";
import { Simulator } from "../core/simulator.js";
import { formatTime } from "../core/time.js";
import type { Decide, EventResult, Expectation, HouseConfig, Scenario, SimEvent } from "../core/types.js";

const HOUSES_DIR = "houses";
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
      return `no motion in ${findZone(house, event.zone).name} for ${house.motionTimeoutMinutes} minutes`;
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
}

interface Options {
  verbose: boolean;
  /** Print only failures and summaries. */
  quiet: boolean;
}

async function runScenario(
  house: HouseConfig,
  scenario: Scenario,
  decide: Decide,
  options: Options,
  totals: Totals,
): Promise<void> {
  const log = options.quiet ? () => {} : console.log;
  const simulator = new Simulator(house, decide, scenario.start);
  const mode = [scenario.start.asleep ? "asleep" : "awake", scenario.start.away ? "away" : "home"].join(", ");
  log(`\n${scenario.name}  (starts ${scenario.start.time}, ${mode})`);
  if (scenario.description) log(`  ${scenario.description}`);

  for (const step of scenario.steps) {
    const results: EventResult[] = [];
    if (step.wait) {
      log(`  ... ${step.wait} minutes pass`);
      results.push(...(await simulator.advance(step.wait)));
    }
    if (step.event) results.push(await simulator.fire(step.event));

    if (!options.quiet) for (const result of results) printResult(house, result, options.verbose);

    for (const [key, expectation] of Object.entries(step.expect ?? {})) {
      const level = simulator.accessories.get(key)?.level ?? "";
      const ok = meets(expectation, level, restingLevel(simulator.kindOf(key)));
      const wanted = Array.isArray(expectation) ? expectation.join(" or ") : expectation;
      if (ok) {
        totals.passed += 1;
        log(`      PASS ${key} is ${level}`);
      } else {
        totals.failed += 1;
        const where = options.quiet ? ` [${scenario.name}, ${formatTime(simulator.minutes)}]` : "";
        console.log(`      FAIL ${key} is ${level}, expected ${wanted}${where}`);
      }
    }
  }
}

/** Resolve an argument to the scenarios it selects, grouped by the house they belong to. */
async function select(target: string): Promise<Map<string, string[]>> {
  // A scenario file lives at <house dir>/scenarios/<name>.json
  if (target.endsWith(".json")) return new Map([[dirname(dirname(target)), [target]]]);

  const scenarioDir = join(target, SCENARIO_DIR);
  const names = (await readdir(scenarioDir)).filter((name) => name.endsWith(".json")).sort();
  return new Map([[target, names.map((name) => join(scenarioDir, name))]]);
}

function summarise(totals: Totals, requests: JevUsage[], scenarios: number, houses: number): string {
  const sum = (pick: (usage: JevUsage) => number) => requests.reduce((total, usage) => total + pick(usage), 0);
  const retryCount = sum((usage) => usage.retries);
  const retries = retryCount === 1 ? "1 retry" : `${retryCount} retries`;
  const slowestMs = Math.max(0, ...requests.map((usage) => usage.ms));
  return (
    `${totals.passed} expectations passed, ${totals.failed} failed across ${scenarios} scenarios in ${houses} houses\n` +
    `${requests.length} Jev requests, ${sum((usage) => usage.inputTokens)} input tokens, ${retries}, ` +
    `${(sum((usage) => usage.ms) / 1000).toFixed(1)}s waiting on Jev (slowest request ${slowestMs}ms)`
  );
}

/** Run every selected scenario once, one request at a time. `requests` fills up as Jev is called. */
async function runAll(
  selected: Map<string, string[]>,
  decide: Decide,
  requests: JevUsage[],
  options: Options,
): Promise<Totals> {
  const totals: Totals = { passed: 0, failed: 0 };
  requests.length = 0;
  let scenarios = 0;
  for (const [houseDir, files] of selected) {
    const house = await readHouse(houseDir);
    const name = house.name ?? houseDir;
    if (!options.quiet) {
      console.log(`\n=== ${name}  (${houseDir}) ===`);
      if (house.description) console.log(house.description);
    }

    const before = { ...totals };
    for (const file of files) {
      await runScenario(house, await readJson<Scenario>(file), decide, options, totals);
    }
    scenarios += files.length;
    const gap = options.quiet ? "  " : "\n";
    console.log(`${gap}${name}: ${totals.passed - before.passed} passed, ${totals.failed - before.failed} failed`);
  }

  console.log(`\n${summarise(totals, requests, scenarios, selected.size)}`);
  return totals;
}

function parseRuns(args: string[]): number {
  const index = args.indexOf("--runs");
  if (index === -1) return 1;
  const runs = Number(args[index + 1]);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a whole number of 1 or more");
  args.splice(index, 2);
  return runs;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runs = parseRuns(args);
  const options: Options = { verbose: args.includes("--verbose"), quiet: args.includes("--quiet") };
  let targets = args.filter((arg) => !arg.startsWith("--")).map((arg) => normalize(arg));
  if (targets.length === 0) {
    targets = (await listHouseIds(HOUSES_DIR)).map((id) => join(HOUSES_DIR, id));
  }

  const selected = new Map<string, string[]>();
  for (const target of targets) {
    for (const [houseDir, files] of await select(target)) {
      selected.set(houseDir, [...(selected.get(houseDir) ?? []), ...files]);
    }
  }

  // Jev's answers can vary slightly between identical requests, so repeating the
  // whole suite is how borderline decisions show up as intermittent failures.
  const requests: JevUsage[] = [];
  const decide = createDecide((usage) => requests.push(usage));
  const failedRuns: number[] = [];
  for (let run = 1; run <= runs; run++) {
    if (runs > 1) console.log(`\n##### Run ${run} of ${runs} #####`);
    const totals = await runAll(selected, decide, requests, options);
    if (totals.failed > 0) failedRuns.push(run);
  }

  if (runs > 1) {
    const verdict = failedRuns.length === 0 ? "all passed" : `failures in run ${failedRuns.join(", ")}`;
    console.log(`\n${runs} runs: ${verdict}`);
  }
  if (failedRuns.length > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
