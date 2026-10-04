import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type {
  ApiError,
  EventResult,
  House,
  HouseState,
  HouseSummary,
  Session,
  SessionStart,
  StepResponse,
  TriggerEvent,
} from "../contract/index.js";
import { listHouseIds, loadHouse } from "../adapters/houses.js";
import type { ConnectDecide, JevUsage } from "../adapters/jev.js";
import { LEVELS } from "../core/levels.js";
import { Simulator } from "../core/simulator.js";
import { formatTime } from "../core/time.js";
import type { EventResult as SimResult, HouseConfig } from "../core/types.js";

/** Sessions live in memory; the oldest is dropped once this many exist. */
const MAX_SESSIONS = 50;
const MAX_ADVANCE_MINUTES = 24 * 60;

export interface AppOptions {
  /** Supplies the simulator's Decide port. createDecide in production, a stand-in in tests. */
  connect: ConnectDecide;
  housesDir: string;
}

const NO_USAGE: JevUsage = { inputTokens: 0, ms: 0, retries: 0 };

interface StoredSession {
  house: House;
  start: SessionStart;
  simulator: Simulator;
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 502,
    message: string,
  ) {
    super(message);
  }
}

function toHouse(id: string, config: HouseConfig): House {
  return {
    id,
    name: config.name ?? id,
    ...(config.description !== undefined && { description: config.description }),
    motionTimeoutMinutes: config.motionTimeoutMinutes,
    rules: config.rules,
    rooms: config.rooms,
    spaces: config.spaces ?? [],
    levels: { light: Object.keys(LEVELS.light), blinds: Object.keys(LEVELS.blinds) },
  };
}

function toState(simulator: Simulator): HouseState {
  return {
    time: formatTime(simulator.minutes),
    mode: { ...simulator.mode },
    accessories: Object.fromEntries(simulator.accessories),
    timeouts: [...simulator.pendingTimeouts]
      .sort((a, b) => a[1] - b[1])
      .map(([zone, due]) => ({ zone, dueTime: formatTime(due), minutesLeft: due - simulator.minutes })),
  };
}

function toResult({ minutes, event, ...rest }: SimResult, usage: JevUsage): EventResult {
  return { time: formatTime(minutes), event, ...rest, ...usage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStart(value: unknown): SessionStart {
  if (!isRecord(value)) throw new HttpError(400, "start must be an object");
  const { time, asleep = false, away = false } = value;
  const match = typeof time === "string" ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new HttpError(400, "start.time must be a time of day as HH:MM");
  }
  if (typeof asleep !== "boolean" || typeof away !== "boolean") {
    throw new HttpError(400, "start.asleep and start.away must be true or false");
  }
  return { time: time as string, asleep, away };
}

function parseEvent(value: unknown, house: House): TriggerEvent {
  if (!isRecord(value)) throw new HttpError(400, "The event must be an object");
  const { type, room } = value;
  switch (type) {
    case "motion":
    case "button":
      if (typeof room !== "string" || !house.rooms.some((r) => r.id === room)) {
        throw new HttpError(400, `Unknown room "${String(room)}"`);
      }
      return { type, room };
    case "sleep":
    case "wake":
    case "leave":
    case "arrive":
      return { type };
    default:
      throw new HttpError(400, "type must be one of motion, button, sleep, wake, leave, arrive");
  }
}

/** The simulator as an HTTP API. Each session is one Simulator, driven by the same calls a scenario makes. */
export function createApp({ connect, housesDir }: AppOptions): Hono {
  const app = new Hono();
  const sessions = new Map<string, StoredSession>();

  /** What the requests of the step in progress cost, in the order they were made. */
  let requests: JevUsage[] = [];
  const decide = connect((usage) => requests.push(usage));

  // The simulator never calls Jev concurrently, so every step waits for the one before it.
  let queue: Promise<unknown> = Promise.resolve();
  function inTurn<T>(step: () => Promise<T>): Promise<T> {
    const result = queue.then(step);
    queue = result.catch(() => {});
    return result;
  }

  function sessionOf(id: string): StoredSession {
    const session = sessions.get(id);
    if (!session) throw new HttpError(404, "This session no longer exists. Restart to begin a new one.");
    return session;
  }

  async function houseOf(id: string): Promise<House> {
    const config = await loadHouse(housesDir, id);
    if (!config) throw new HttpError(404, `Unknown house "${id}"`);
    return toHouse(id, config);
  }

  async function body(request: Request): Promise<unknown> {
    try {
      return await request.json();
    } catch {
      throw new HttpError(400, "The request body must be JSON");
    }
  }

  async function step(session: StoredSession, run: () => Promise<SimResult[]>): Promise<StepResponse> {
    try {
      return await inTurn(async () => {
        requests = [];
        const results = await run();
        // Steps run one at a time and each event that was not skipped made exactly one request, in order.
        const costs = [...requests];
        return {
          results: results.map((result) => toResult(result, (result.skipped ? undefined : costs.shift()) ?? NO_USAGE)),
          state: toState(session.simulator),
        };
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, `Jev did not answer: ${reason}`);
    }
  }

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json<ApiError>({ error: error.message }, error.status);
    console.error(error);
    return c.json<ApiError>({ error: "Something went wrong in the simulator server" }, 500);
  });

  app.get("/api/houses", async (c) => {
    const ids = await listHouseIds(housesDir);
    const houses = await Promise.all(ids.map(houseOf));
    return c.json<HouseSummary[]>(
      houses.map(({ id, name, description }) => ({ id, name, ...(description !== undefined && { description }) })),
    );
  });

  app.get("/api/houses/:id", async (c) => c.json<House>(await houseOf(c.req.param("id"))));

  app.post("/api/sessions", async (c) => {
    const request = await body(c.req.raw);
    if (!isRecord(request) || typeof request.house !== "string") throw new HttpError(400, "house must be a house id");
    const start = parseStart(request.start);
    const config = await loadHouse(housesDir, request.house);
    if (!config) throw new HttpError(400, `Unknown house "${request.house}"`);

    const session: StoredSession = {
      house: toHouse(request.house, config),
      start,
      simulator: new Simulator(config, decide, start),
    };
    const id = randomUUID();
    sessions.set(id, session);
    const oldest = sessions.keys().next();
    if (sessions.size > MAX_SESSIONS && !oldest.done) sessions.delete(oldest.value);

    return c.json<Session>({ id, house: session.house, start, state: toState(session.simulator) }, 201);
  });

  app.get("/api/sessions/:id", (c) => {
    const id = c.req.param("id");
    const session = sessionOf(id);
    return c.json<Session>({ id, house: session.house, start: session.start, state: toState(session.simulator) });
  });

  app.post("/api/sessions/:id/events", async (c) => {
    const session = sessionOf(c.req.param("id"));
    const event = parseEvent(await body(c.req.raw), session.house);
    return c.json<StepResponse>(await step(session, async () => [await session.simulator.fire(event)]));
  });

  app.post("/api/sessions/:id/advance", async (c) => {
    const session = sessionOf(c.req.param("id"));
    const request = await body(c.req.raw);
    const minutes = isRecord(request) ? request.minutes : undefined;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ADVANCE_MINUTES) {
      throw new HttpError(400, `minutes must be a whole number from 1 to ${MAX_ADVANCE_MINUTES}`);
    }
    return c.json<StepResponse>(await step(session, () => session.simulator.advance(minutes)));
  });

  app.delete("/api/sessions/:id", (c) => {
    sessions.delete(c.req.param("id"));
    return c.body(null, 204);
  });

  app.all("/api/*", () => {
    throw new HttpError(404, "No such API endpoint");
  });

  return app;
}
