import type { EventResult, House, SessionStart } from "../contract/index.js";
import { describe, iconOf, minutesLabel } from "./format.js";
import { Icon } from "./ui.js";

/** One row of the timeline: an event's outcome, or the clock being advanced. */
export type Entry = { id: number; result: EventResult } | { id: number; minutesPassed: number };

interface TimelineProps {
  house: House;
  start: SessionStart;
  /** Newest first. */
  entries: Entry[];
  /** How many of the newest entries came from the latest step. */
  latestCount: number;
  error: string | null;
  onDismissError: () => void;
}

function Summary({ results }: { results: EventResult[] }) {
  const sent = results.filter((result) => !result.skipped);
  const ms = sent.reduce((total, result) => total + result.ms, 0);
  const tokens = sent.reduce((total, result) => total + result.inputTokens, 0);
  const retries = sent.reduce((total, result) => total + result.retries, 0);
  const slowest = Math.max(0, ...sent.map((result) => result.ms));
  const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
  return (
    <p class="mt-1 text-xs text-muted-foreground" data-summary>
      {plural(results.length, "event", "events")} &middot; {plural(sent.length, "Jev request", "Jev requests")} &middot;{" "}
      {plural(tokens, "input token", "input tokens")} &middot; {(ms / 1000).toFixed(1)} s waiting on Jev (slowest {slowest} ms)
      &middot; {plural(retries, "retry", "retries")}
    </p>
  );
}

function Decisions({ result }: { result: EventResult }) {
  const acted = new Set(result.changes.map((change) => change.key));
  return (
    <details class="group mt-2.5">
      <summary class="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground">
        <Icon name="chevron" class="transition-transform group-open:rotate-90" />
        All {result.decisions.length} decisions
      </summary>
      <ul class="mt-2 grid gap-1 font-mono text-xs text-muted-foreground">
        {result.decisions.map((decision) => {
          const options = Object.entries(decision.probabilities)
            .filter(([, p]) => p >= 0.01)
            .sort((a, b) => b[1] - a[1]);
          return (
            <li key={decision.key} class="grid grid-cols-[20ch_minmax(0,1fr)] gap-x-2">
              <span class="break-all">{decision.key}</span>
              <span>
                {options.map(([option, p], i) => (
                  <span key={option}>
                    {i > 0 && " · "}
                    <span class={i === 0 && acted.has(decision.key) ? "font-medium text-foreground" : ""}>
                      {option} {p.toFixed(2)}
                    </span>
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ResultEntry({ house, result, latest }: { house: House; result: EventResult; latest: boolean }) {
  return (
    <li class={`px-5 py-3 ${latest ? "bg-highlight" : ""}`} data-entry={result.event.type}>
      <div class="flex items-center gap-2">
        <time class="font-mono text-[13px] text-muted-foreground tabular-nums">{result.time}</time>
        <Icon name={iconOf(result.event)} />
        <h3 class="font-medium">{describe(house, result.event)}</h3>
        {!result.skipped && (
          <span class="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{result.ms} ms</span>
        )}
      </div>
      {result.skipped ? (
        <p class="mt-1.5 text-[13px] text-muted-foreground">Not sent to Jev: {result.skipped}.</p>
      ) : (
        <>
          {result.changes.length === 0 && result.uncertain.length === 0 && (
            <p class="mt-1.5 text-[13px] text-muted-foreground">No changes</p>
          )}
          <ul class="mt-2 grid gap-1 font-mono text-[13px] empty:hidden">
            {result.changes.map((change) => (
              <li key={change.key} class="chg" data-change={change.key}>
                <span class="break-all">{change.key}</span>
                <span>
                  {change.from} &rarr; {change.to}
                </span>
                <span class="text-right text-muted-foreground">{change.probability.toFixed(2)}</span>
              </li>
            ))}
            {result.uncertain.map((change) => (
              <li key={change.key} class="chg text-muted-foreground" data-unsure={change.key}>
                <span class="break-all">{change.key}</span>
                <span class="pill border-dashed font-sans">unsure</span>
                <span class="text-right">{change.probability.toFixed(2)}</span>
                <span class="col-span-3 font-sans text-xs">
                  Left at {change.from}. Jev leaned towards {change.to}, below the 0.60 needed to act.
                </span>
              </li>
            ))}
          </ul>
          <Decisions result={result} />
        </>
      )}
    </li>
  );
}

export function Timeline({ house, start, entries, latestCount, error, onDismissError }: TimelineProps) {
  const results = entries.flatMap((entry) => ("result" in entry ? [entry.result] : []));
  const mode = `${start.asleep ? "asleep" : "awake"}, ${start.away ? "away" : "home"}`;
  return (
    <section class="card overflow-hidden" aria-labelledby="timeline-title">
      <header class="border-b px-5 py-3">
        <div class="flex items-baseline justify-between gap-3">
          <h2 id="timeline-title" class="font-semibold">
            Timeline
          </h2>
          <span class="text-xs text-muted-foreground">Newest first</span>
        </div>
        <Summary results={results} />
      </header>

      {error && (
        <div role="alert" class="m-3 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[13px]">
          <div class="min-w-0 flex-1">
            <p class="font-medium text-destructive">The last step failed</p>
            <p class="mt-0.5 break-words text-muted-foreground">{error}</p>
          </div>
          <button type="button" class="btn btn-outline" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      )}

      <ol class="divide-y" data-timeline>
        {results.length === 0 && (
          <li class="px-5 py-3 text-[13px] text-muted-foreground">
            No events yet. Trigger motion or a wall button in a room, or fire a house event.
          </li>
        )}
        {entries.map((entry, index) =>
          "result" in entry ? (
            <ResultEntry key={entry.id} house={house} result={entry.result} latest={index < latestCount} />
          ) : (
            <li key={entry.id} class="gap-row">
              {minutesLabel(entry.minutesPassed)} {entry.minutesPassed === 1 ? "passes" : "pass"}
            </li>
          ),
        )}
        <li class="gap-row">
          Session started at {start.time}, {mode}
        </li>
      </ol>
    </section>
  );
}
