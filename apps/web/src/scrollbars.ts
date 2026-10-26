export function autoHideScrollbars(root: Document = document): () => void {
  const timers = new WeakMap<Element, number>();
  const onScroll = (event: Event) => {
    const element = event.target;
    if (
      !(element instanceof HTMLElement) ||
      !element.classList.contains("auto-scrollbar")
    )
      return;
    element.classList.add("is-scrolling");
    window.clearTimeout(timers.get(element));
    timers.set(
      element,
      window.setTimeout(() => element.classList.remove("is-scrolling"), 900),
    );
  };
  // Scroll events don't bubble, so listen in the capture phase.
  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => root.removeEventListener("scroll", onScroll, { capture: true });
}
