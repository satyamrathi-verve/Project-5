/*
  Inline SVG icon set — no dependency, tree-shakeable, inherits `currentColor`.
  Pure component (no hooks), so it's safe in both server and client components.
*/
import type { SVGProps } from "react";

export type IconName =
  | "grid"
  | "home"
  | "users"
  | "book"
  | "file"
  | "receipt"
  | "upload"
  | "mail"
  | "scroll"
  | "bars"
  | "trend"
  | "login"
  | "logout"
  | "bell"
  | "search"
  | "sun"
  | "moon"
  | "settings"
  | "plus"
  | "chevronLeft"
  | "chevronRight"
  | "menu"
  | "close"
  | "dots"
  | "eye"
  | "pencil"
  | "copy"
  | "clock"
  | "trash"
  | "check"
  | "filter"
  | "download"
  | "star"
  | "folder"
  | "link";

const PATHS: Record<IconName, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3 3 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-3-4.9" />
    </>
  ),
  book: <path d="M5 4h11a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5H5zM5 4v16" />,
  file: (
    <>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  receipt: <path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21zM9 8h6M9 12h6" />,
  upload: <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </>
  ),
  scroll: <path d="M7 4h10a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2v-1h11v1M9 8h6M9 12h6" />,
  bars: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  trend: <path d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" />,
  login: <path d="M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4M10 12H3m0 0 4-4m-4 4 4 4" />,
  logout: <path d="M9 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h4M16 12H8m8 0-4-4m4 4-4 4" />,
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.5 1.5 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.5 1.5 0 0 0-2.5.6 1.5 1.5 0 0 0-1 1.4V22a2 2 0 0 1-4 0v-.2a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-1H2a2 2 0 0 1 0-4h.2a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1A2 2 0 1 1 6 3.5l.1.1a1.5 1.5 0 0 0 1.7.3H8a1.5 1.5 0 0 0 1-1.4V2a2 2 0 0 1 4 0v.2a1.5 1.5 0 0 0 1 1.4 1.5 1.5 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.5 1.5 0 0 0-.3 1.7V8a1.5 1.5 0 0 0 1.4 1H22a2 2 0 0 1 0 4h-.2a1.5 1.5 0 0 0-1.4 1z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  pencil: <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17v3zM14.5 8.5l2 2" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" />,
  check: <path d="m5 12 5 5 9-11" />,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4z" />,
  download: <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h3.4l1.6 1.8H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  link: <path d="M9.5 14.5l5-5M10.5 6.8l1-1a3.5 3.5 0 0 1 5 5l-1 1M13.5 17.2l-1 1a3.5 3.5 0 0 1-5-5l1-1" />,
};

export function Icon({
  name,
  size = 20,
  filled = false,
  ...props
}: { name: IconName; size?: number; filled?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
