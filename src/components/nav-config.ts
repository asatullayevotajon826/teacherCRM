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
 * `enabled` BAYROG'I (PR H2) — NIMA UCHUN KERAK
 * --------------------------------------------
 * Menyuda 10 ta havola bor edi, lekin ularning sahifasi hali yozilmagan:
 * /penalties, /penalty-criteria, /rewards, /reward-criteria, /payments,
 * /reports, /messages, /tests, /users, /ai-assistant.
 *
 * Bosilganda 404 chiqardi. Bu ikki tomondan yomon:
 *   1. Foydalanuvchi "tizim buzuq" deb o'ylaydi;
 *   2. Yo'q sahifa menyuda turgani uchun nima ishlayotgani va nima
 *      ishlamayotgani hujjatsiz qoladi.
 *
 * MUHIM: bu sahifalar O'CHIRILMAYDI va KELAJAKDA YARATILADI. Shu sababli:
 *   - `rbac.ts` dagi `roleAllowedPaths` yozuvlari TEGILMAYDI — ruxsat
 *     jadvali allaqachon to'g'ri va sahifa tayyor bo'lganda darhol ishlaydi;
 *   - `item` ro'yxatidan havola O'CHIRILMAYDI — nomi, manzili va ikonkasi
 *     joyida qoladi;
 *   - faqat KO'RINISHI o'chiriladi.
 *
 * SAHIFA TAYYOR BO'LGANDA: shu havoladagi `enabled: false` qatorini olib
 * tashlash kifoya. Boshqa hech qayerda o'zgartirish kerak emas.
 *
 * XAVFSIZLIK ESLATMASI: `enabled` — bu QULAYLIK bayrog'i, himoya EMAS.
 * Havolani yashirish sahifani yopmaydi. Haqiqiy himoya uch qatlamda:
 * `middleware.ts` + `rbac.ts` (sahifa darajasi), `auth-guard.ts` (rol) va
 * `scope.ts` (qatorlar doirasi). Yangi sahifa qo'shilganda ularning
 * hammasi to'ldirilishi shart — menyuni ochish o'zi yetarli emas.
 */

export type NavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  /**
   * Sukut bo'yicha havola ko'rinadi. `false` — sahifa hali yaratilmagani
   * uchun havola vaqtincha yashirilgan (yuqoridagi izohga qarang).
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

  // --- Sahifasi hali yaratilmagan havolalar (H2 da yashirildi) ---
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
  // --- Yashirilgan havolalar tugadi ---

  subjects: { key: "subjects", href: "/subjects", icon: Library },
  academicYears: {
    key: "academicYears",
    href: "/academic-years",
    icon: CalendarRange,
  },
  lessonPeriods: { key: "lessonPeriods", href: "/lesson-periods", icon: Clock },
} satisfies Record<string, NavItem>;

/**
 * To'liq menyu tarkibi — yashirilgan havolalar ham shu yerda turadi.
 *
 * Bu ro'yxat "tizim qanday bo'lishi kerak" ni ko'rsatadi, foydalanuvchi
 * ko'radigan holatni emas. Pastda filtrlanadi.
 */
const fullNavGroupsByRole: Record<Role, NavGroup[]> = {
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

/** Bayroq yo'q bo'lsa havola ko'rinadi — ya'ni faqat `false` yashiradi. */
function isEnabled(navItem: NavItem): boolean {
  return navItem.enabled !== false;
}

/**
 * Guruhlarni filtrlaydi va BO'SH QOLGAN guruhni butunlay olib tashlaydi.
 *
 * Bo'sh guruhni qoldirib bo'lmaydi: `sidebar.tsx` har bir guruh uchun
 * yig'iladigan sarlavha chizadi, ya'ni ekranda ichi bo'sh "Moliya" tugmasi
 * paydo bo'lardi. Masalan buxgalter uchun "finance" va "system" guruhlarining
 * hamma havolasi yashirilgan.
 */
function visibleGroups(groups: NavGroup[]): NavGroup[] {
  return groups
    .map((group) => ({
      groupKey: group.groupKey,
      items: group.items.filter(isEnabled),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Komponentlar SHUNI ishlatadi — ya'ni filtr bitta joyda.
 *
 * Shu sababli `sidebar.tsx` va `mobile-nav.tsx` ga tegishga hojat yo'q va
 * kelajakda yangi menyu komponenti qo'shilsa ham yashirilgan havola
 * tasodifan chiqib ketmaydi.
 */
export const navGroupsByRole: Record<Role, NavGroup[]> = {
  ADMIN: visibleGroups(fullNavGroupsByRole.ADMIN),
  TEACHER: visibleGroups(fullNavGroupsByRole.TEACHER),
  ACCOUNTANT: visibleGroups(fullNavGroupsByRole.ACCOUNTANT),
  PARENT: visibleGroups(fullNavGroupsByRole.PARENT),
};

export const navByRole: Record<Role, NavItem[]> = {
  ADMIN: navGroupsByRole.ADMIN.flatMap((group) => group.items),
  TEACHER: navGroupsByRole.TEACHER.flatMap((group) => group.items),
  ACCOUNTANT: navGroupsByRole.ACCOUNTANT.flatMap((group) => group.items),
  PARENT: navGroupsByRole.PARENT.flatMap((group) => group.items),
};

/**
 * Vaqtincha yashirilgan havolalar manzillari.
 *
 * Test uchun kerak: "menyuda sahifasi yo'q havola qolmadimi?" degan
 * tekshiruv shu ro'yxatga tayanadi. Qo'lda takrorlamaslik uchun `item`
 * ning o'zidan hisoblanadi.
 */
export const HIDDEN_NAV_HREFS: string[] = (Object.values(item) as NavItem[])
  .filter((navItem) => !isEnabled(navItem))
  .map((navItem) => navItem.href);
