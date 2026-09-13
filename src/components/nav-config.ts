import {
  LayoutDashboard,
  Users,
  GraduationCap,
  School,
  CalendarDays,
  CalendarRange,
  Clock,
  Library,
  ClipboardCheck,
  ClipboardList,
  BookOpenCheck,
  Trophy,
  AlertTriangle,
  SlidersHorizontal,
  Award,
  Medal,
  Wallet,
  BarChart3,
  MessageSquare,
  FileQuestion,
  UserCog,
  Bot,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@prisma/client";

/**
 * YON MENYU TARKIBI
 * =================
 *
 * `enabled` BAYROG'I — NIMA UCHUN KERAK
 * ------------------------------------
 * Menyuda 10 ta havola bor, lekin ularning sahifasi hali yozilmagan:
 * /penalties, /penalty-criteria, /rewards, /reward-criteria, /payments,
 * /reports, /messages, /tests, /users, /ai-assistant.
 *
 * TARIX VA HOZIRGI QAROR:
 *   - Boshida ular oddiy havola edi — bosilganda 404 chiqardi.
 *   - PR H2 da ular menyudan BUTUNLAY yashirildi.
 *   - H4f (egasining talabi): ular yana KO'RINADI, lekin BOSILMAYDI.
 *     Sabab: tizimda qanday bo'limlar bo'lishi rejalashtirilgani ko'rinib
 *     tursin, lekin ishlamaydigan havola bosilib 404 bermasin.
 *
 * Ya'ni `enabled: false` endi "yashirish" emas, "QULFLASH" degani.
 *
 * MUHIM: bu sahifalar O'CHIRILMAYDI va KELAJAKDA YARATILADI. Shu sababli:
 *   - `item` ro'yxatidan havola O'CHIRILMAYDI — nomi, manzili va ikonkasi
 *     joyida qoladi;
 *   - faqat BOSILISHI to'sib qo'yiladi.
 *
 * SAHIFA TAYYOR BO'LGANDA: shu havoladagi `enabled: false` qatorini olib
 * tashlash kifoya. Boshqa hech qayerda o'zgartirish kerak emas.
 *
 * XAVFSIZLIK ESLATMASI (o'zgarmadi): `enabled` — bu QULAYLIK bayrog'i,
 * himoya EMAS. Havolani qulflash sahifani yopmaydi va buni qilishga
 * urinmaydi ham. Haqiqiy himoya uch qatlamda: `middleware.ts` + `rbac.ts`
 * (sahifa darajasi), `auth-guard.ts` (rol) va `scope.ts` (qatorlar
 * doirasi). Yangi sahifa qo'shilganda ularning hammasi to'ldirilishi shart
 * — menyuni ochish o'zi yetarli emas.
 */

export type NavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  /**
   * Sukut bo'yicha havola ishlaydi. `false` — sahifa hali yaratilmagani
   * uchun havola QULFLANGAN: ko'rinadi, lekin bosilmaydi (yuqoridagi
   * izohga qarang).
   */
  enabled?: boolean;
};
export type NavGroup = { groupKey: string; items: NavItem[] };

const item = {
  dashboard: { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  students: { key: "students", href: "/students", icon: Users },
  teachers: { key: "teachers", href: "/teachers", icon: GraduationCap },
  classes: { key: "classes", href: "/classes", icon: School },
  schedule: { key: "schedule", href: "/schedule", icon: CalendarDays },
  attendance: { key: "attendance", href: "/attendance", icon: ClipboardCheck },
  // Kunlik jurnal — baho va davomat KIRITISH joyi. Menyuda "Baholar"dan
  // oldin turadi, chunki kundalik ish shu yerda boshlanadi.
  journal: { key: "journal", href: "/journal", icon: ClipboardList },
  grades: { key: "grades", href: "/grades", icon: BookOpenCheck },
  ranking: { key: "ranking", href: "/ranking", icon: Trophy },

  // --- Sahifasi hali yaratilmagan havolalar (H4f da qulflandi) ---
  // 7-bosqichda jarima ball tizimi yozilganda ochiladi.
  penalties: {
    key: "penalties",
    href: "/penalties",
    icon: AlertTriangle,
    enabled: false,
  },
  penaltyCriteria: {
    key: "penaltyCriteria",
    href: "/penalty-criteria",
    icon: SlidersHorizontal,
    enabled: false,
  },
  rewards: { key: "rewards", href: "/rewards", icon: Award, enabled: false },
  rewardCriteria: {
    key: "rewardCriteria",
    href: "/reward-criteria",
    icon: Medal,
    enabled: false,
  },
  payments: {
    key: "payments",
    href: "/payments",
    icon: Wallet,
    enabled: false,
  },
  reports: {
    key: "reports",
    href: "/reports",
    icon: BarChart3,
    enabled: false,
  },
  messages: {
    key: "messages",
    href: "/messages",
    icon: MessageSquare,
    enabled: false,
  },
  tests: {
    key: "tests",
    href: "/tests",
    icon: FileQuestion,
    enabled: false,
  },
  aiAssistant: {
    key: "aiAssistant",
    href: "/ai-assistant",
    icon: Bot,
    enabled: false,
  },
  users: { key: "users", href: "/users", icon: UserCog, enabled: false },
  // --- Qulflangan havolalar tugadi ---

  subjects: { key: "subjects", href: "/subjects", icon: Library },
  academicYears: {
    key: "academicYears",
    href: "/academic-years",
    icon: CalendarRange,
  },
  lessonPeriods: { key: "lessonPeriods", href: "/lesson-periods", icon: Clock },
} satisfies Record<string, NavItem>;

/**
 * MENYU TARKIBI — komponentlar SHUNI ishlatadi.
 *
 * H4f dan oldin bu ro'yxat filtrlanardi (`visibleGroups`) va qulflangan
 * havolalar butunlay tushib qolardi. Endi filtr YO'Q: ro'yxat to'liq
 * ko'rsatiladi, `enabled: false` bo'lgan element esa `sidebar.tsx` da
 * havola sifatida emas, qulflangan qator sifatida chiziladi.
 *
 * Filtr olib tashlanganining yon foydasi: bo'sh guruh muammosi ham yo'q
 * bo'ldi (ilgari buxgalterning "finance" va "system" guruhlari butunlay
 * bo'shab qolar, shuning uchun maxsus tozalash kerak edi).
 */
export const navGroupsByRole: Record<Role, NavGroup[]> = {
  ADMIN: [
    { groupKey: "overview", items: [item.dashboard] },
    {
      groupKey: "academic",
      items: [
        item.students,
        item.teachers,
        item.classes,
        item.schedule,
        item.attendance,
        item.journal,
        item.grades,
        item.ranking,
        item.tests,
      ],
    },
    {
      groupKey: "discipline",
      items: [
        item.penalties,
        item.penaltyCriteria,
        item.rewards,
        item.rewardCriteria,
      ],
    },
    { groupKey: "finance", items: [item.payments, item.reports] },
    {
      groupKey: "system",
      items: [item.messages, item.aiAssistant, item.users],
    },
    {
      groupKey: "settings",
      items: [item.subjects, item.academicYears, item.lessonPeriods],
    },
  ],
  TEACHER: [
    { groupKey: "overview", items: [item.dashboard] },
    {
      groupKey: "academic",
      items: [
        item.students,
        item.classes,
        item.schedule,
        item.attendance,
        item.journal,
        item.grades,
        item.ranking,
        item.tests,
      ],
    },
    {
      groupKey: "discipline",
      items: [item.penalties, item.rewards],
    },
    { groupKey: "system", items: [item.aiAssistant] },
  ],
  ACCOUNTANT: [
    { groupKey: "overview", items: [item.dashboard] },
    { groupKey: "academic", items: [item.students] },
    { groupKey: "finance", items: [item.payments, item.reports] },
    { groupKey: "system", items: [item.messages] },
  ],
  PARENT: [
    { groupKey: "overview", items: [item.dashboard] },
    {
      groupKey: "academic",
      items: [item.grades, item.attendance, item.ranking],
    },
    {
      groupKey: "discipline",
      items: [item.penalties, item.rewards],
    },
    { groupKey: "finance", items: [item.payments] },
  ],
};

/** Bayroq yo'q bo'lsa havola ishlaydi — ya'ni faqat `false` qulflaydi. */
export function isNavItemEnabled(navItem: NavItem): boolean {
  return navItem.enabled !== false;
}

/**
 * FAQAT ISHLAYDIGAN havolalar.
 *
 * Semantika ATAYLAB o'zgartirilmadi: bu ro'yxat H4f dan oldin ham faqat
 * bosiladigan havolalarni qaytargan. Agar bu yerga qulflangan havolalar
 * ham qo'shilsa, uni ishlatuvchi kod (masalan navigatsiya tekshiruvi)
 * ishlamaydigan sahifani ochiq deb hisoblab qolishi mumkin edi.
 */
export const navByRole: Record<Role, NavItem[]> = {
  ADMIN: navGroupsByRole.ADMIN.flatMap((group) =>
    group.items.filter(isNavItemEnabled)
  ),
  TEACHER: navGroupsByRole.TEACHER.flatMap((group) =>
    group.items.filter(isNavItemEnabled)
  ),
  ACCOUNTANT: navGroupsByRole.ACCOUNTANT.flatMap((group) =>
    group.items.filter(isNavItemEnabled)
  ),
  PARENT: navGroupsByRole.PARENT.flatMap((group) =>
    group.items.filter(isNavItemEnabled)
  ),
};

/**
 * Qulflangan havolalar manzillari (sahifasi hali yo'q).
 *
 * Test uchun kerak: "menyuda sahifasi yo'q havola bosiladigan holda
 * qolmadimi?" degan tekshiruv shu ro'yxatga tayanadi. Qo'lda
 * takrorlamaslik uchun `item` ning o'zidan hisoblanadi.
 *
 * Nom o'zgartirilmadi (`HIDDEN_NAV_HREFS`), chunki ma'nosi bir xil qoldi:
 * sahifasi mavjud bo'lmagan havolalar ro'yxati.
 */
export const HIDDEN_NAV_HREFS: string[] = (Object.values(item) as NavItem[])
  .filter((navItem) => !isNavItemEnabled(navItem))
  .map((navItem) => navItem.href);
