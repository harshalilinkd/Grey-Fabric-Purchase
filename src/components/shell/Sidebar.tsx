"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NAV, TOP_ITEMS, type NavItem } from "@/lib/nav";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types";

const OPEN_KEY = "grey-fms-nav-open";

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  operator: "Operator",
};

const isItemActive = (path: string, pathname: string) =>
  path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/");

const ALL_ITEMS: NavItem[] = [...TOP_ITEMS, ...NAV.flatMap((g) => g.items)];

/** Path of the nav item matching the current route (if any). */
const activeItemPath = (pathname: string) =>
  ALL_ITEMS.find((it) => isItemActive(it.path, pathname))?.path ?? null;

/** Which group contains the current route (so we can keep it expanded). */
function activeGroupHeading(pathname: string): string | null {
  for (const group of NAV) {
    if (group.items.some((it) => isItemActive(it.path, pathname))) return group.heading;
  }
  return null;
}

/** Deterministic default (same on server + first client render): active group open, rest closed. */
function defaultOpen(pathname: string): Record<string, boolean> {
  const active = activeGroupHeading(pathname);
  return Object.fromEntries(NAV.map((g) => [g.heading, g.heading === active]));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const groupId = (heading: string) =>
  "nav-sec-" + heading.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function Sidebar({
  mobileOpen,
  onNavigate,
  profile,
  email,
}: {
  mobileOpen: boolean;
  onNavigate: () => void;
  profile: Profile;
  email: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState<Record<string, boolean>>(() => defaultOpen(pathname));
  // True when the desktop icon-rail is active (html.sb-collapsed @ >900px) —
  // there the CSS force-shows every group, so "closed" groups stay interactive.
  const [rail, setRail] = useState(false);
  const [mounted, setMounted] = useState(false);

  const name = profile.full_name?.trim() || email || "User";

  const navRef = useRef<HTMLElement | null>(null);
  const indRef = useRef<HTMLSpanElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLAnchorElement>());
  const rafId = useRef(0);
  const trackUntil = useRef(0);

  /* ---- sliding active indicator -------------------------------------- */
  // Measures the active link and moves the pill to it. Kept in a ref so the
  // rAF tracking loop always sees fresh pathname/open/rail without rebinding.
  const applyRef = useRef<() => void>(() => {});
  applyRef.current = () => {
    const nav = navRef.current;
    const ind = indRef.current;
    if (!nav || !ind) return;
    const path = activeItemPath(pathname);
    const el = path ? itemRefs.current.get(path) : null;
    const group = activeGroupHeading(pathname);
    if (!el || (group && !open[group] && !rail)) {
      ind.style.opacity = "0";
      return;
    }
    const nb = nav.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    ind.style.opacity = "1";
    ind.style.transform = `translate(${eb.left - nb.left + nav.scrollLeft}px, ${eb.top - nb.top + nav.scrollTop}px)`;
    ind.style.width = `${eb.width}px`;
    ind.style.height = `${eb.height}px`;
  };

  // Re-measure every frame for a short window so the pill smoothly follows
  // items that are still moving (group expand/collapse, rail width change).
  const kick = useCallback((ms = 450) => {
    trackUntil.current = performance.now() + ms;
    if (rafId.current) return;
    const step = () => {
      applyRef.current();
      rafId.current = performance.now() < trackUntil.current ? requestAnimationFrame(step) : 0;
    };
    rafId.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  // Position before paint, then enable the pill's transitions one frame later
  // so the first placement doesn't animate in from (0, 0).
  useLayoutEffect(() => {
    setMounted(true);
    applyRef.current();
    const id = requestAnimationFrame(() => indRef.current?.classList.add("ready"));
    return () => cancelAnimationFrame(id);
  }, []);

  useLayoutEffect(() => {
    applyRef.current();
    kick();
  }, [pathname, open, rail, kick]);

  // Catch layout shifts the tracking window might outlive.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onEnd = () => applyRef.current();
    const onResize = () => kick(150);
    nav.addEventListener("transitionend", onEnd);
    window.addEventListener("resize", onResize);
    return () => {
      nav.removeEventListener("transitionend", onEnd);
      window.removeEventListener("resize", onResize);
    };
  }, [kick]);

  // Track the icon-rail state (class on <html>, toggled outside React).
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(min-width: 901px)");
    const update = () => setRail(mq.matches && root.classList.contains("sb-collapsed"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    mq.addEventListener("change", update);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);

  // Keep the active link in view when navigating.
  useEffect(() => {
    const path = activeItemPath(pathname);
    if (path) itemRefs.current.get(path)?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  /* ---- group expand/collapse ------------------------------------------ */
  // Merge the user's saved expand/collapse preferences once, after mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, boolean>;
      setOpen((cur) => {
        const merged = { ...cur, ...saved };
        const active = activeGroupHeading(pathname);
        if (active) merged[active] = true; // never hide the current page
        return merged;
      });
    } catch {
      /* ignore malformed storage */
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The group containing the active page auto-expands as the route changes.
  useEffect(() => {
    const active = activeGroupHeading(pathname);
    if (active) setOpen((cur) => (cur[active] ? cur : { ...cur, [active]: true }));
  }, [pathname]);

  const toggle = useCallback((heading: string) => {
    setOpen((cur) => {
      const next = { ...cur, [heading]: !cur[heading] };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const renderItem = (item: NavItem) => {
    const active = isItemActive(item.path, pathname);
    return (
      <Link
        key={item.path}
        href={item.path}
        ref={(el) => {
          if (el) itemRefs.current.set(item.path, el);
          else itemRefs.current.delete(item.path);
        }}
        className={`nav-item${active ? " active" : ""}`}
        aria-current={active ? "page" : undefined}
        data-tip={item.label}
        onClick={onNavigate}
      >
        <Icon name={item.icon} />
        <span className="nav-label">{item.label}</span>
      </Link>
    );
  };

  return (
    <aside className={`sidebar${mobileOpen ? " mobile-open" : ""}`} id="sidebar">
      <div className="sb-brand">
        <div className="sb-logo" aria-hidden="true">LD</div>
        <div className="sb-name">
          LD Silk Mills
          <small>Grey FMS</small>
        </div>
      </div>

      <nav ref={navRef} className={`sb-nav${mounted ? " has-ind" : ""}`} aria-label="Primary">
        <span ref={indRef} className="nav-ind" aria-hidden="true" />

        <div className="nav-top-items">{TOP_ITEMS.map(renderItem)}</div>

        {NAV.map((group) => {
          const isOpen = !!open[group.heading];
          const id = groupId(group.heading);
          return (
            <div key={group.heading} className={`nav-group${isOpen ? " open" : ""}`}>
              <button
                type="button"
                className="nav-group-header"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => toggle(group.heading)}
              >
                <span className="ngh-label">{group.heading}</span>
                <Icon name="chevron" size={13} />
              </button>

              {/* inert: links in a closed group leave the tab order — except in
                  the icon rail, where CSS keeps every group visible */}
              <div className="nav-group-items" id={id} inert={!isOpen && !rail ? true : undefined}>
                <div className="nav-branch">{group.items.map(renderItem)}</div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sb-user">
        <div className="sb-avatar" data-tip={name}>{initials(name)}</div>
        <div className="sb-user-meta">
          <span className="sb-user-name" title={name}>{name}</span>
          <span className="sb-user-role">{ROLE_LABELS[profile.role] ?? profile.role}</span>
        </div>
        <button
          type="button"
          className="sb-signout"
          onClick={signOut}
          aria-label="Sign out"
          data-tip="Sign out"
        >
          <Icon name="logout" size={16} />
        </button>
      </div>
    </aside>
  );
}
