import type { CSSProperties } from "react";
export type IconName =
  | "clock"
  | "sun"
  | "moon"
  | "plus"
  | "close"
  | "up"
  | "down"
  | "chevron"
  | "copy"
  | "download"
  | "link"
  | "search"
  | "shield"
  | "arrow";
const paths: Record<IconName, string> = {
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
  moon: "M20 13a8 8 0 1 1-9-9 7 7 0 0 0 9 9",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M6 18L18 6",
  up: "M6 14l6-6 6 6",
  down: "M6 10l6 6 6-6",
  chevron: "M9 5l7 7-7 7",
  copy: "M9 9h11v11H9zM15 5V3H3v12h2",
  download: "M12 3v12M7 10l5 5 5-5M4 17v4h16v-4",
  link: "M9 15l6-6M7 14l-2 2a3 3 0 0 0 4 4l3-3M17 10l2-2a3 3 0 0 0-4-4l-3 3",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6",
  shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6",
  arrow: "M4 12h16M14 6l6 6-6 6",
};
export default function Icon({
  name,
  style,
}: {
  name: IconName;
  style?: CSSProperties;
}) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
