"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
  { href: "/bank", label: "Bank" },
  { href: "/applications", label: "Applications" },
  { href: "/profile", label: "Profile" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="border-b border-slate-200 bg-white">
      <ul className="mx-auto flex max-w-4xl gap-1 px-8 py-2">
        {LINKS.map((link) => {
          const isActive = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`block rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
