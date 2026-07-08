/*
  Global z-index hierarchy — the single source of truth for stacking order.
  =========================================================================
  Every floating UI element in the ERP uses these values (via the shared
  overlay components) so nothing ever renders behind another component. Ordered
  low → high; large gaps leave room for future layers.
*/

export const Z = {
  stickyHeader: 100, // app header / sticky toolbars
  stickyTableHeader: 150, // sticky <thead>
  tableContent: 200, // sticky first columns, in-flow content
  dropdown: 3000, // generic dropdowns / column choosers / autocomplete
  filterMenu: 3100, // column filter menus
  contextMenu: 3200, // row / right-click action menus
  popover: 3300, // general popovers
  tooltip: 3400, // hover tooltips
  dialog: 4000, // modal dialogs + drawers + their backdrops
  notification: 5000, // toasts / notifications (always on top)
} as const;

export type OverlayLayer = keyof typeof Z;
