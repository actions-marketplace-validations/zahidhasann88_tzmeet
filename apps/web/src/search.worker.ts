import { findSlots, type NormalizedInput } from "@tzmeet/core";

const scope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<{ id: number; input: NormalizedInput }>) => void)
    | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = (event) => {
  const { id, input } = event.data;
  try {
    scope.postMessage({ id, result: findSlots(input) });
  } catch (error) {
    scope.postMessage({
      id,
      error:
        error instanceof Error ? error.message : "Unable to calculate slots.",
    });
  }
};
