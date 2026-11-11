import { getStore, type Store } from "./db/client";
import { readCatalog } from "./catalog";
import { readSessions, readAssessments, readErrors } from "./learning";
import { readTasks, readSuggestions } from "./tasks";
import { localDay } from "@/lib/dates";
export function reviewWorkspaceData(
  store: Store = getStore(),
  clock = new Date(),
) {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";
  return store.raw.transaction(() => ({
    catalog: readCatalog(store),
    tasks: readTasks(store, clock),
    suggestions: readSuggestions(store, clock),
    sessions: readSessions(store),
    assessments: readAssessments(undefined, store),
    errors: readErrors(undefined, store),
    timeZone,
    today: localDay(clock.toISOString(), timeZone),
  }))();
}
