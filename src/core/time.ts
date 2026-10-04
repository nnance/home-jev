/** "HH:MM" to minutes since midnight. */
export function parseTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Invalid time "${time}", expected HH:MM`);
  }
  return hours * 60 + minutes;
}

/** Minutes since midnight to "HH:MM", wrapping past midnight. */
export function formatTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
