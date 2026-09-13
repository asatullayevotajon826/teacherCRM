"use client";

import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Role } from "@prisma/client";
import { Link, usePathname } from "@/i18n/navigation";
import {
  navGroupsByRole,
  isNavItemEnabled,
  type NavItem,
} from "./nav-config";
import { cn } from "@/lib/utils";

interface SidebarProps {
  role: Role;
  onNavigate?: () => void;
}

/** Havola va qulflangan qator uchun umumiy o'lcham — ikkisi bir tekis turadi. */
const ROW_CLASS =
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium";

/**
 * QULFLANGAN MENYU QATORI (H4f)
 * =============================
 *
 * Sahifasi hali yaratilmagan bo'lim ko'rinib turadi, lekin BOSILMAYDI.
 *
 * NEGA `<Link>` EMAS, `<span>`:
 * `<Link>` ni "o'chirish" ishonchsiz — `onClick` da `preventDefault()`
 * qilinsa ham havolaning o'zi qoladi: o'rta tugma bilan yangi oynada
 * ochish, "havolani nusxalash", klaviatura bilan Enter va qidiruv
 * botlarining o'tishi ishlayveradi. Natijada foydalanuvchi baribir 404
 * sahifaga tushardi.
 *
 * `<span>` da `href` UMUMAN yo'q — ya'ni bosishning hech qanday yo'li
 * qolmaydi. Egasining talabi aynan shu: "ko'rinib tursin, lekin bossa
 * ishlamasin, havolasi yopiq tursin".
 *
 * KO'RISH IMKONIYATI (a11y):
 *   - `aria-disabled="true"` — ekran o'quvchisi "o'chirilgan" deb aytadi;
 *   - fokusga tushmaydi (`<span>` da `tabIndex` yo'q), ya'ni Tab bilan
 *     yurganda ishlamaydigan element ushlab qolmaydi;
 *   - qulf ikonkasi `aria-hidden` — ma'no `aria-disabled` da, ikonka esa
 *     faqat ko'rish uchun;
 *   - `title` ham qo'yilmadi: hozir menyu nomidan boshqa aytadigan matn
 *     yo'q, tarjima kaliti esa `messages/*.json` ga yangi qator qo'shishni
 *     talab qilardi. Sahifa nima uchun yopiqligini tushuntiruvchi matn
 *     kerak bo'lsa, uchta tilga kalit qo'shib keyin qilinadi.
 *
 * MUHIM: bu ko'rinish qatlami, HIMOYA EMAS. Foydalanuvchi manzilni qo'lda
 * yozsa ham himoya `middleware.ts` + `rbac.ts` va server qorovullarida
 * turadi — shu yerda emas.
 */
function LockedNavRow({ label }: { label: string }) {
  return (
    <span
      aria-disabled="true"
      className={cn(
        ROW_CLASS,
        "cursor-not-allowed text-muted-foreground/60 select-none"
      )}
    >
      <span className="flex flex-1 items-center gap-3">{label}</span>
      <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
    </span>
  );
}

function NavGroup({
  groupKey,
  items,
  pathname,
  onNavigate,
}: {
  groupKey: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(true);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-md bg-primary px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-primary-foreground"
        aria-expanded={open}
      >
        <span>{t(`groups.${groupKey}`)}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            !open && "-rotate-90"
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-1 pt-1">
            {items.map((navItem) => {
              const { key, href, icon: Icon } = navItem;

              // Sahifasi yo'q bo'lim: ko'rinadi, lekin havola emas.
              if (!isNavItemEnabled(navItem)) {
                return (
                  <LockedNavRow
                    key={key}
                    label={t(key)}
                  />
                );
              }

              const active =
                pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={key}
                  href={href}
                  onClick={onNavigate}
                  className={cn(
                    ROW_CLASS,
                    "transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{t(key)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ role, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const groups = navGroupsByRole[role];

  return (
    <nav className="flex flex-col gap-3">
      {groups.map(({ groupKey, items }) => (
        <NavGroup
          key={groupKey}
          groupKey={groupKey}
          items={items}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}
