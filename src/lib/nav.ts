/**
 * Single source of truth for the sidebar navigation.
 * Dashboard is a standalone top-level link; the rest are grouped under section
 * headings: Procurement → Dyeing → Quality & Stock → Admin.
 */
export type NavItem = {
  label: string;
  path: string;
  icon: string;
  /** short description used on each placeholder page */
  blurb: string;
};

export type NavGroup = {
  heading: string;
  items: NavItem[];
};

/** Standalone top-level links — rendered as main branches (no section heading). */
export const TOP_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/", icon: "grid", blurb: "Live overview of your grey fabric pipeline" },
];

export const NAV: NavGroup[] = [
  {
    heading: "Procurement",
    items: [
      { label: "Sampling & Approval", path: "/sampling-approval", icon: "checkCircle", blurb: "Pre-PO sample submissions and their approval — raise a PO once approved" },
      { label: "Purchase Orders", path: "/purchase-orders", icon: "file", blurb: "Grey fabric purchase orders from vendors" },
      { label: "Grey House Follow Up", path: "/grey-receipts", icon: "box", blurb: "Sent vs pending grey fabric per PO — log shipments to create lots" },
    ],
  },
  {
    heading: "Dyeing",
    items: [
      { label: "Dyeing Queue", path: "/dyeing-queue", icon: "lines", blurb: "Lots awaiting or in dyeing — create & view program cards here" },
      { label: "Dyeing Follow Up", path: "/dyeing-follow-up", icon: "clock", blurb: "Chase dyeing houses on lots that are due or overdue" },
      { label: "Fabric Receipts", path: "/fabric-receipts", icon: "truck", blurb: "Receive dyed fabric back from the dyeing house" },
    ],
  },
  {
    heading: "Quality & Stock",
    items: [
      { label: "QC Inspection", path: "/qc-inspection", icon: "checkCircle", blurb: "Quality check on dyed fabric returns" },
      { label: "Reissue & Return", path: "/reissue-return", icon: "refresh", blurb: "Send failed fabric back for re-dyeing and track returns" },
      { label: "Final Receipts", path: "/final-receipts", icon: "clipboardCheck", blurb: "Confirm final QC-passed quantities before warehousing" },
      { label: "Warehouse", path: "/warehouse", icon: "warehouse", blurb: "QC-passed fabric grouped by program card" },
    ],
  },
  {
    heading: "Admin",
    items: [
      { label: "Settings", path: "/settings", icon: "settings", blurb: "Team access & workspace preferences" },
    ],
  },
];

/** Flat lookup used by pages to render their own title/blurb without duplication. */
export const NAV_BY_PATH: Record<string, NavItem> = Object.fromEntries(
  [...TOP_ITEMS, ...NAV.flatMap((g) => g.items)].map((item) => [item.path, item]),
);
