import type { ComponentChildren } from "preact";

export function Icon({ name, class: className = "" }: { name: string; class?: string }) {
  return (
    <svg class={`icon ${className}`} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

interface EventButtonProps {
  /** Identifies this control while its request is in flight. */
  id: string;
  /** The id of the control waiting on Jev, if any. Every event control is disabled meanwhile. */
  busy: string | null;
  icon?: string;
  onRun: (id: string) => void;
  children: ComponentChildren;
}

export function EventButton({ id, busy, icon, onRun, children }: EventButtonProps) {
  return (
    <button
      type="button"
      class="btn btn-outline"
      data-control={id}
      disabled={busy !== null}
      aria-busy={busy === id}
      onClick={() => onRun(id)}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function TimerPill({ dueTime, minutesLeft }: { dueTime: string; minutesLeft: number }) {
  return (
    <span class="pill" data-timeout>
      <Icon name="timer" />
      Times out <span class="font-mono tabular-nums">{dueTime}</span>
      <span class="font-normal text-muted-foreground">in {minutesLeft} min</span>
    </span>
  );
}
