import { reportSectionLocation } from "./sections";

/** Report detail routes share the same mounted review editor and draft state. */
export function leavesReviewPage(destination: string, current: string) {
  const from = new URL(current),
    to = new URL(destination, from);
  const source = reportSectionLocation(from.pathname);
  const target = reportSectionLocation(to.pathname);
  if (to.origin === from.origin && source && target && source.id === target.id)
    return false;
  return to.origin !== from.origin || to.pathname !== from.pathname;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One instance per mounted app/tab. Memory survives client navigation, never a reload. */
export function createDraftStorage(browser: () => DraftStorage) {
  const memory = new Map<string, string | null>();
  const failed = new Set<string>();
  return {
    getItem(key: string) {
      if (memory.has(key)) return memory.get(key) ?? null;
      try {
        const value = browser().getItem(key);
        memory.set(key, value);
        return value;
      } catch {
        // Edits must still reach setItem's memory copy when the storage getter throws.
        memory.set(key, null);
        failed.add(key);
        return null;
      }
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
      try {
        browser().setItem(key, value);
        failed.delete(key);
      } catch (error) {
        failed.add(key);
        throw error;
      }
    },
    removeItem(key: string) {
      // Keep a tombstone so failed browser cleanup cannot resurrect a discarded draft.
      memory.set(key, null);
      try {
        browser().removeItem(key);
        failed.delete(key);
      } catch (error) {
        failed.add(key);
        throw error;
      }
    },
    isVolatile(key: string) {
      return failed.has(key) && !!memory.get(key);
    },
    hasVolatileDrafts() {
      return [...failed].some((key) => !!memory.get(key));
    },
  };
}
