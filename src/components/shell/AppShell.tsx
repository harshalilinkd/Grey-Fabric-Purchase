"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ExperienceLayer } from "@/components/experience/ExperienceLayer";
import type { Profile } from "@/lib/types";

const SIDEBAR_KEY = "grey-fms-sidebar";
const MOBILE_BREAKPOINT = 900;

export function AppShell({
  children,
  profile,
  email,
}: {
  children: ReactNode;
  profile: Profile;
  email: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const handleToggleSidebar = useCallback(() => {
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      setMobileOpen((open) => !open);
      return;
    }
    const root = document.documentElement;
    const collapsed = root.classList.toggle("sb-collapsed");
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ExperienceLayer>
      <div className="app">
        <Sidebar
          mobileOpen={mobileOpen}
          onNavigate={() => setMobileOpen(false)}
          profile={profile}
          email={email}
        />
        {mobileOpen && <div className="sb-backdrop" aria-hidden="true" onClick={() => setMobileOpen(false)} />}
        <div className="main">
          <TopBar onToggleSidebar={handleToggleSidebar} profile={profile} email={email} />
          <main className="content">{children}</main>
        </div>
      </div>
    </ExperienceLayer>
  );
}
