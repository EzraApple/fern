import useSWR from "swr";
import * as api from "./api";

export function useSessions() {
  return useSWR("sessions", () => api.fetchSessions(), {
    refreshInterval: 10_000,
  });
}

export function useSession(id: string | null) {
  return useSWR(id ? `session-${id}` : null, () => api.fetchSession(id as string));
}

export function useSessionMessages(id: string | null, live = false) {
  return useSWR(
    id ? `session-messages-${id}` : null,
    () => api.fetchSessionMessages(id as string),
    {
      refreshInterval: live ? 3_000 : 0,
    }
  );
}

export function useMemories(type?: string) {
  return useSWR(["memories", type], () => api.fetchMemories({ type: type || undefined }));
}

export function useArchives(threadId?: string) {
  return useSWR(["archives", threadId], () => api.fetchArchives({ threadId }));
}

export function usePRs(state = "all") {
  return useSWR(["prs", state], () => api.fetchPRs({ state }));
}

export function useTools() {
  return useSWR("tools", () => api.fetchTools());
}
