import type { Accessory, House, HouseState, Room, TriggerEvent } from "../contract/index.js";
import { EventButton, Icon, TimerPill } from "./ui.js";

/** What the latest step did, keyed by "room.accessory". */
export interface Highlights {
  /** The level each changed accessory had before. */
  changedFrom: Map<string, string>;
  /** The level Jev leaned towards without acting. */
  leanedTo: Map<string, string>;
}

interface HouseViewProps {
  house: House;
  state: HouseState;
  highlights: Highlights;
  busy: string | null;
  onFire: (controlId: string, event: TriggerEvent) => void;
}

function Level({ house, accessory, level }: { house: House; accessory: Accessory; level: string }) {
  const levels = house.levels[accessory.kind];
  const index = levels.indexOf(level);
  const resting = index <= 0;
  return (
    <>
      {accessory.kind === "light" ? (
        <span class="meter" aria-hidden="true">
          {levels.slice(1).map((name, i) => (
            <i key={name} class={i < index ? "on" : ""} />
          ))}
        </span>
      ) : (
        <Icon name={resting ? "blinds-closed" : "blinds-open"} />
      )}
      <span class={resting ? "text-muted-foreground" : "font-medium"}>{level}</span>
    </>
  );
}

function AccessoryRow({ house, room, accessory, state, highlights }: Omit<HouseViewProps, "busy" | "onFire"> & { room: Room; accessory: Accessory }) {
  const key = `${room.id}.${accessory.id}`;
  const current = state.accessories[key];
  const from = highlights.changedFrom.get(key);
  const leaned = highlights.leanedTo.get(key);
  const emphasis = from !== undefined ? "acc-changed" : leaned !== undefined ? "acc-unsure" : "";
  return (
    <li class={`acc ${emphasis}`} data-accessory={key} data-level={current?.level}>
      <div class="min-w-0">
        <div class="acc-name">{accessory.id}</div>
        <div class="acc-desc">{accessory.description}</div>
      </div>
      <div>
        <div class="acc-level">
          {from !== undefined && <span class="text-muted-foreground">{from} &rarr;</span>}
          <Level house={house} accessory={accessory} level={current?.level ?? ""} />
        </div>
        {leaned !== undefined ? (
          <div class="acc-source">unsure, leaned {leaned}</div>
        ) : (
          current?.turnedOnBy && <div class="acc-source">by {current.turnedOnBy}</div>
        )}
      </div>
    </li>
  );
}

function RoomSection({ room, standalone, ...props }: HouseViewProps & { room: Room; standalone: boolean }) {
  const { state, busy, onFire } = props;
  const Heading = standalone ? "h2" : "h3";
  const timeout = standalone ? state.timeouts.find((t) => t.zone === room.id) : undefined;
  return (
    <section class={standalone ? "card p-3" : "bg-card p-3"} data-room={room.id}>
      <header class="flex items-center justify-between gap-2 px-2.5 pb-2">
        <Heading class="font-semibold">{room.name}</Heading>
        <div class="flex gap-1.5">
          <EventButton id={`motion:${room.id}`} busy={busy} icon="motion" onRun={(id) => onFire(id, { type: "motion", room: room.id })}>
            Motion
          </EventButton>
          <EventButton id={`button:${room.id}`} busy={busy} icon="button" onRun={(id) => onFire(id, { type: "button", room: room.id })}>
            Wall button
          </EventButton>
        </div>
      </header>
      {timeout && (
        <p class="px-2.5 pb-2">
          <TimerPill {...timeout} />
        </p>
      )}
      <ul class="flex flex-col gap-0.5">
        {room.accessories.map((accessory) => (
          <AccessoryRow key={accessory.id} {...props} room={room} accessory={accessory} />
        ))}
      </ul>
    </section>
  );
}

/** An open space is one surface with hairlines between its rooms; walled rooms are separate cards. */
export function HouseView(props: HouseViewProps) {
  const { house, state } = props;
  const inSpace = new Set(house.spaces.flatMap((space) => space.rooms));
  const standalone = house.rooms.filter((room) => !inSpace.has(room.id));
  return (
    <>
      {house.spaces.map((space) => {
        const rooms = house.rooms.filter((room) => space.rooms.includes(room.id));
        const timeout = state.timeouts.find((t) => t.zone === space.id);
        return (
          <section key={space.id} class="card overflow-hidden" data-space={space.id}>
            <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-3">
              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 class="font-semibold">{space.name}</h2>
                <span class="pill text-muted-foreground">Open space</span>
                <span class="text-xs text-muted-foreground">{rooms.length} rooms sharing one motion timer</span>
              </div>
              {timeout && <TimerPill {...timeout} />}
            </header>
            <div class="grid gap-px bg-border @[44rem]:grid-cols-2">
              {rooms.map((room) => (
                <RoomSection key={room.id} {...props} room={room} standalone={false} />
              ))}
            </div>
          </section>
        );
      })}
      {standalone.length > 0 && (
        <div class="grid items-start gap-5 @[44rem]:grid-cols-2">
          {standalone.map((room) => (
            <RoomSection key={room.id} {...props} room={room} standalone={true} />
          ))}
        </div>
      )}
    </>
  );
}

export function Rules({ house }: { house: House }) {
  return (
    <details open class="card group">
      <summary class="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl px-5 py-3">
        <Icon name="chevron" class="transition-transform group-open:rotate-90" />
        <h2 class="font-semibold">Rules</h2>
        <span class="text-xs text-muted-foreground">
          {house.rules.length} plain-English rules applied by Jev &middot; motion timeout {house.motionTimeoutMinutes} minutes
        </span>
      </summary>
      <ul class="divide-y border-t px-5 text-[13px] leading-relaxed">
        {house.rules.map((rule) => (
          <li key={rule} class="max-w-[80ch] py-2">
            {rule}
          </li>
        ))}
      </ul>
    </details>
  );
}
