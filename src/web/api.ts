import type {
  AdvanceRequest,
  ApiError,
  CreateSessionRequest,
  HouseSummary,
  Session,
  StepResponse,
  TriggerEvent,
} from "../contract/index.js";

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(failure?.error ?? `The simulator server answered ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  houses: () => request<HouseSummary[]>("/api/houses"),
  createSession: (body: CreateSessionRequest) => request<Session>("/api/sessions", body),
  session: (id: string) => request<Session>(`/api/sessions/${id}`),
  fire: (id: string, event: TriggerEvent) => request<StepResponse>(`/api/sessions/${id}/events`, event),
  advance: (id: string, body: AdvanceRequest) => request<StepResponse>(`/api/sessions/${id}/advance`, body),
};
