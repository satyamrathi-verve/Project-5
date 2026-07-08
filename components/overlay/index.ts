/*
  Global overlay / portal architecture — public barrel.
  =====================================================
  Import floating UI from here so it always renders above every page element,
  never clipped by a parent's overflow, following the global z-index hierarchy.

    import { Popover, Menu, Tooltip, Z } from "@/components/overlay";

  • Popover — dropdowns, column choosers, filter menus, autocomplete panels.
  • Menu    — row/context action menus with keyboard navigation.
  • Tooltip — themed hover tooltips.
  • Z       — the z-index scale (single source of truth).
*/

export { Z, type OverlayLayer } from "./zIndex";
export { Popover } from "./Popover";
export { Menu, type MenuItem } from "./Menu";
export { Tooltip } from "./Tooltip";
export { computePosition, useOverlay } from "./useOverlay";
