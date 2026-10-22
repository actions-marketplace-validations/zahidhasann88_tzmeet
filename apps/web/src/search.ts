import { useEffect, useRef, useState } from "react";
import {
  findSlots,
  type FindSlotsResult,
  type validateInput,
} from "@tzmeet/core";

export interface SlotSearch {
  result: FindSlotsResult | null;
  error: string;
  pending: boolean;
}

let worker: Worker | null | undefined;
function searchWorker(): Worker | null {
  if (worker === undefined) {
    try {
      worker =
        typeof Worker === "undefined"
          ? null
          : new Worker(new URL("./search.worker.ts", import.meta.url), {
              type: "module",
            });
    } catch {
      worker = null;
    }
  }
  return worker;
}

function searchInline(
  input: Parameters<typeof findSlots>[0],
): Omit<SlotSearch, "pending"> {
  try {
    return { result: findSlots(input), error: "" };
  } catch (error) {
    return {
      result: null,
      error:
        error instanceof Error ? error.message : "Unable to calculate slots.",
    };
  }
}

export function useSlotSearch(
  checked: ReturnType<typeof validateInput>,
): SlotSearch {
  const [search, setSearch] = useState<SlotSearch>({
    result: null,
    error: "",
    pending: true,
  });
  const latest = useRef(0);
  useEffect(() => {
    const id = ++latest.current;
    if (!checked.success) {
      setSearch({
        result: null,
        error: checked.errors
          .map((error) => `${error.path}: ${error.message}`)
          .join("; "),
        pending: false,
      });
      return;
    }
    const target = searchWorker();
    if (!target) {
      setSearch({ ...searchInline(checked.data), pending: false });
      return;
    }
    setSearch((current) => ({ ...current, pending: true }));
    const onMessage = (
      event: MessageEvent<{
        id: number;
        result?: FindSlotsResult;
        error?: string;
      }>,
    ) => {
      if (event.data.id !== id || id !== latest.current) return;
      setSearch({
        result: event.data.result ?? null,
        error: event.data.error ?? "",
        pending: false,
      });
    };
    const onError = () => {
      worker = null;
      if (id === latest.current)
        setSearch({ ...searchInline(checked.data), pending: false });
    };
    target.addEventListener("message", onMessage);
    target.addEventListener("error", onError);
    target.postMessage({ id, input: checked.data });
    return () => {
      target.removeEventListener("message", onMessage);
      target.removeEventListener("error", onError);
    };
  }, [checked]);
  return search;
}
