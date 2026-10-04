import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session, StepResponse } from "../contract/index.js";
import { NO_CHANGE } from "../core/jev.js";
import type { Decide } from "../core/types.js";
import { createApp } from "./app.js";

/** Stands in for Jev: motion turns the kitchen can lights on, a motion timeout turns them off. */
const decide: Decide = async (snapshot, event) => {
  const choice = event.type === "motion" ? "standard" : event.type === "motion_timeout" ? "off" : NO_CHANGE;
  return {
    decisions: [...snapshot.accessories.keys()].map((key) => {
      const picked = key === "kitchen.can" ? choice : NO_CHANGE;
      return { key, choice: picked, probabilities: { [picked]: 0.9 }, confidence: 0.9 };
    }),
    inputTokens: 100,
    ms: 5,
    retries: 0,
  };
};

const app = createApp({ decide, housesDir: "houses" });

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, { method: "POST", body: JSON.stringify(body) });
}

async function startSession(): Promise<Session> {
  const start = { time: "20:00", asleep: false, away: false };
  const response = await post("/api/sessions", { house: "open-plan", start });
  assert.equal(response.status, 201);
  return (await response.json()) as Session;
}

test("lists the houses under houses/", async () => {
  const houses = (await (await app.request("/api/houses")).json()) as { id: string; name: string }[];
  assert.ok(houses.some((house) => house.id === "open-plan" && house.name === "Open plan"));
});

test("a new session starts at rest with no timers", async () => {
  const session = await startSession();
  assert.equal(session.state.time, "20:00");
  assert.deepEqual(session.state.accessories["kitchen.can"], { level: "off", turnedOnBy: null });
  assert.deepEqual(session.state.timeouts, []);
  assert.deepEqual(session.house.levels.light, ["off", "soft", "standard", "full"]);
});

test("an event changes the house and starts the zone's motion timer", async () => {
  const session = await startSession();
  const response = await post(`/api/sessions/${session.id}/events`, { type: "motion", room: "kitchen" });
  const { results, state } = (await response.json()) as StepResponse;

  assert.equal(results.length, 1);
  assert.deepEqual(results[0]?.changes, [{ key: "kitchen.can", from: "off", to: "standard", probability: 0.9 }]);
  assert.deepEqual(state.accessories["kitchen.can"], { level: "standard", turnedOnBy: "motion" });
  assert.deepEqual(state.timeouts, [{ zone: "main", dueTime: "20:05", minutesLeft: 5 }]);
});

test("advancing the clock fires the motion timeout that comes due", async () => {
  const session = await startSession();
  await post(`/api/sessions/${session.id}/events`, { type: "motion", room: "kitchen" });
  const response = await post(`/api/sessions/${session.id}/advance`, { minutes: 6 });
  const { results, state } = (await response.json()) as StepResponse;

  assert.deepEqual(results[0]?.event, { type: "motion_timeout", zone: "main" });
  assert.equal(results[0]?.time, "20:05");
  assert.equal(state.time, "20:06");
  assert.equal(state.accessories["kitchen.can"]?.level, "off");
  assert.deepEqual(state.timeouts, []);
});

test("house events change the mode", async () => {
  const session = await startSession();
  const response = await post(`/api/sessions/${session.id}/events`, { type: "sleep" });
  assert.equal(((await response.json()) as StepResponse).state.mode.asleep, true);
});

test("bad requests are rejected without touching the simulator", async () => {
  const session = await startSession();
  const events = `/api/sessions/${session.id}/events`;
  assert.equal((await post(events, { type: "motion", room: "attic" })).status, 400);
  assert.equal((await post(events, { type: "motion_timeout", zone: "main" })).status, 400);
  assert.equal((await post(`/api/sessions/${session.id}/advance`, { minutes: 0 })).status, 400);
  assert.equal((await post("/api/sessions", { house: "../src", start: { time: "20:00" } })).status, 400);
  assert.equal((await post("/api/sessions", { house: "open-plan", start: { time: "25:00" } })).status, 400);
  assert.equal((await post("/api/sessions/nope/events", { type: "sleep" })).status, 404);
});

test("a failing Jev request is reported as a bad gateway", async () => {
  const failing = createApp({
    decide: async () => {
      throw new Error("503 overloaded");
    },
    housesDir: "houses",
  });
  const created = await failing.request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ house: "open-plan", start: { time: "20:00" } }),
  });
  const { id } = (await created.json()) as Session;
  const response = await failing.request(`/api/sessions/${id}/events`, {
    method: "POST",
    body: JSON.stringify({ type: "sleep" }),
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Jev did not answer: 503 overloaded" });
});
