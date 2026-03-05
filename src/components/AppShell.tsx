"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import HoneycombBackground from "./HoneycombBackground";
import { ToastProvider } from "./Toast";

const NAV_LINKS = [
  { href: "/dashboard",     label: "Dashboard" },
  { href: "/transactions",  label: "Transactions" },
  { href: "/insights",      label: "Insights" },
  { href: "/settings",      label: "Settings" },
] as const;

export default function AppShell({
  children,
  title,
  userEmail,
  onLogout,
}: {
  children: React.ReactNode;
  title?: string;
  userEmail?: string | null;
  onLogout?: () => void;
}) {
  const pathname = usePathname();

  return (
    <ToastProvider>
    <div className="min-h-screen relative">
      <HoneycombBackground />
      <header className="sticky top-0 z-10 bg-[rgba(4,5,6,0.88)] backdrop-blur-[22px] border-b border-white/[0.07]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-lg font-semibold tracking-[0.22em] text-white/90"
              style={{ fontFamily: "var(--font-jetbrains-mono)" }}
            >
              <SpineLogo className="h-[30px] w-auto opacity-90" />
              <span>SPINE</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV_LINKS.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`relative px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      active
                        ? "text-white"
                        : "text-[var(--text-dim)] hover:text-white/80"
                    }`}
                  >
                    {active && (
                      <span className="absolute inset-0 rounded-lg bg-white/[0.07]" />
                    )}
                    <span className="relative">{label}</span>
                    {active && (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[2px] rounded-full bg-[var(--gold)]" />
                    )}
                  </Link>
                );
              })}
              {userEmail && (
                <span className="text-[var(--text-muted)] text-sm ml-4">{userEmail}</span>
              )}
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="text-[var(--text-dim)] hover:text-white/80 transition-colors text-sm ml-2 px-3 py-1.5"
                >
                  Logout
                </button>
              )}
            </nav>
          </div>
        </div>
      </header>
      <main className="relative z-[1] max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {title && (
          <h1 className="text-2xl font-bold tracking-tight text-white mb-6">
            {title}
          </h1>
        )}
        {children}
      </main>
    </div>
    </ToastProvider>
  );
}

function SpineLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 142" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="20" cy="5" r="4" />
      <circle cx="20" cy="33" r="12" />
      <ellipse cx="20" cy="68" rx="16" ry="11" transform="rotate(15,20,68)" />
      <circle cx="20" cy="99" r="9" />
      <circle cx="20" cy="121" r="6" />
      <circle cx="20" cy="137" r="4" />
    </svg>
  );
}
