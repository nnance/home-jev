import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { EventResult, HouseSummary, Session, SessionStart, StepResponse, TriggerEvent } from "../contract/index.js";
import { api } from "./api.js";
import { type Highlights, HouseView, Rules } from "./house.js";
import { type Entry, Timeline } from "./timeline.js";
import { EventButton } from "./ui.js";

const HOUSE_EVENTS = [
  { type: "sleep", label: "Sleep" },
  { type: "wake", label: "Wake" },
  { type: "leave", label: "Leave" },
  { type: "arrive", label: "Arrive" },
] as const;

const MAX_ADVANCE_MINUTES = 24 * 60;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The browser's time of day, as a starting point. The simulated clock never follows it afterwards. */
function timeNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function App() {
  const [houses, setHouses] = useState<HouseSummary[]>([]);
  const [houseId, setHouseId] = useState("");
  const [start, setStart] = useState<SessionStart>({ time: timeNow(), asleep: false, away: false });
  const [session, setSession] = useState<Session | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [latest, setLatest] = useState<EventResult[]>([]);
  const [customMinutes, setCustomMinutes] = useState("10");
  /** The control whose request is in flight. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextEntryId = useRef(0);

  async function restart(house: string) {
    setBusy("restart");
    setError(null);
    try {
      setSession(await api.createSession({ house, start }));
      setEntries([]);
      setLatest([]);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(null);
    }
  }

  // Runs once, when the page loads.
  useEffect(() => {
    (async () => {
      try {
        const found = await api.houses();
        setHouses(found);
        const first = found[0];
        if (!first) throw new Error("No houses found under houses/");
        setHouseId(first.id);
        await restart(first.id);
      } catch (failure) {
        setError(message(failure));
      }
    })();
  }, []);

  async function run(controlId: string, minutesPassed: number, step: (sessionId: string) => Promise<StepResponse>) {
    if (!session || busy) return;
    setBusy(controlId);
    setError(null);
    try {
      const { results, state } = await step(session.id);
      const added: Entry[] = results.map((result) => ({ id: nextEntryId.current++, result })).reverse();
      if (minutesPassed > 0) added.push({ id: nextEntryId.current++, minutesPassed });
      setEntries((current) => [...added, ...current]);
      setLatest(results);
      setSession({ ...session, state });
    } catch (failure) {
      setError(message(failure));
      // The step may have moved the clock or the mode before failing, so show what the simulator holds now.
      api.session(session.id).then(setSession, () => {});
    } finally {
      setBusy(null);
    }
  }

  const fire = (controlId: string, event: TriggerEvent) => run(controlId, 0, (id) => api.fire(id, event));
  const advance = (controlId: string, minutes: number) => run(controlId, minutes, (id) => api.advance(id, { minutes }));

  const highlights = useMemo<Highlights>(() => {
    const changedFrom = new Map<string, string>();
    const leanedTo = new Map<string, string>();
    for (const result of latest) {
      for (const change of result.changes) if (!changedFrom.has(change.key)) changedFrom.set(change.key, change.from);
      for (const change of result.uncertain) leanedTo.set(change.key, change.to);
    }
    for (const key of changedFrom.keys()) leanedTo.delete(key);
    return { changedFrom, leanedTo };
  }, [latest]);

  const custom = Number(customMinutes);
  const customValid = Number.isInteger(custom) && custom >= 1 && custom <= MAX_ADVANCE_MINUTES;

  return (
    <div class="mx-auto flex max-w-[1360px] flex-col gap-5 px-4 py-5 text-sm sm:px-6">
      <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div class="flex items-baseline gap-2.5">
          <h1 class="font-mono text-base font-medium">home-jev</h1>
          <span class="text-muted-foreground">Interactive simulator</span>
        </div>
        <div class="flex flex-wrap items-end gap-x-4 gap-y-2">
          <label class="grid gap-1" for="house">
            <span class="eyebrow">House</span>
            <select
              id="house"
              class="field"
              value={houseId}
              disabled={busy !== null}
              onChange={(event) => {
                setHouseId(event.currentTarget.value);
                restart(event.currentTarget.value);
              }}
            >
              {houses.map((house) => (
                <option key={house.id} value={house.id}>
                  {house.name}
                </option>
              ))}
            </select>
          </label>
          <label class="grid gap-1" for="start-time">
            <span class="eyebrow">Start time</span>
            <input
              id="start-time"
              type="time"
              required
              class="field font-mono"
              value={start.time}
              // A half-typed time reads as empty; keep the last complete one until it is whole again.
              onInput={(event) => event.currentTarget.value && setStart({ ...start, time: event.currentTarget.value })}
            />
          </label>
          <fieldset>
            <legend class="eyebrow mb-1">Start mode</legend>
            <div class="flex h-8 items-center gap-3 text-[13px]">
              <label class="flex items-center gap-1.5" for="start-asleep">
                <input
                  id="start-asleep"
                  type="checkbox"
                  class="accent-primary"
                  checked={start.asleep}
                  onChange={(event) => setStart({ ...start, asleep: event.currentTarget.checked })}
                />
                Asleep
              </label>
              <label class="flex items-center gap-1.5" for="start-away">
                <input
                  id="start-away"
                  type="checkbox"
                  class="accent-primary"
                  checked={start.away}
                  onChange={(event) => setStart({ ...start, away: event.currentTarget.checked })}
                />
                Away
              </label>
            </div>
          </fieldset>
          <button
            type="button"
            id="restart"
            class="btn btn-primary"
            disabled={busy !== null || !houseId || !start.time}
            aria-busy={busy === "restart"}
            onClick={() => restart(houseId)}
          >
            Restart
          </button>
        </div>
      </header>

      {!session ? (
        <p class="card px-5 py-4 text-muted-foreground" role={error ? "alert" : "status"}>
          {error ? <span class="text-destructive">{error}</span> : "Starting a session…"}
        </p>
      ) : (
        <>
          <section
            class="card grid gap-x-10 gap-y-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-[auto_auto_1fr_auto]"
            aria-label="House status and controls"
          >
            <div class="flex flex-col gap-2">
              <span class="eyebrow">Simulated clock</span>
              <span id="clock" class="flex h-8 items-center font-mono text-3xl font-medium tabular-nums">
                {session.state.time}
              </span>
              <span class="text-xs text-muted-foreground">Moves only when you advance it</span>
            </div>
            <div class="flex flex-col gap-2">
              <span class="eyebrow">Mode</span>
              <div id="mode" class="flex h-8 items-center gap-1.5">
                <span class={`pill ${session.state.mode.asleep ? "pill-solid" : ""}`}>
                  {session.state.mode.asleep ? "Asleep" : "Awake"}
                </span>
                <span class={`pill ${session.state.mode.away ? "pill-solid" : ""}`}>
                  {session.state.mode.away ? "Away" : "Home"}
                </span>
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <span class="eyebrow">Advance clock</span>
              <div class="flex flex-wrap items-center gap-1.5">
                <EventButton id="advance:1" busy={busy} onRun={(id) => advance(id, 1)}>
                  +1 min
                </EventButton>
                <EventButton id="advance:5" busy={busy} onRun={(id) => advance(id, 5)}>
                  +5 min
                </EventButton>
                <label class="ml-2 flex items-center gap-1.5 text-[13px] text-muted-foreground" for="advance-minutes">
                  <input
                    id="advance-minutes"
                    type="number"
                    min="1"
                    max={MAX_ADVANCE_MINUTES}
                    class="field w-16 font-mono text-foreground"
                    value={customMinutes}
                    onInput={(event) => setCustomMinutes(event.currentTarget.value)}
                  />
                  min
                </label>
                <EventButton id="advance:custom" busy={customValid ? busy : "invalid"} onRun={(id) => advance(id, custom)}>
                  Advance
                </EventButton>
              </div>
              <span class="text-xs text-muted-foreground">Motion timeouts that come due fire on the way</span>
            </div>
            <div class="flex flex-col gap-2">
              <span class="eyebrow">House events</span>
              <div class="flex flex-wrap items-center gap-1.5">
                {HOUSE_EVENTS.map(({ type, label }) => (
                  <EventButton key={type} id={type} busy={busy} icon={type} onRun={(id) => fire(id, { type })}>
                    {label}
                  </EventButton>
                ))}
              </div>
            </div>
          </section>

          <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div class="@container flex min-w-0 flex-col gap-5">
              <HouseView house={session.house} state={session.state} highlights={highlights} busy={busy} onFire={fire} />
              <Rules house={session.house} />
            </div>
            <Timeline
              house={session.house}
              start={session.start}
              entries={entries}
              latestCount={latest.length}
              error={error}
              onDismissError={() => setError(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}
