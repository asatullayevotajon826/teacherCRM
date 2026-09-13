import type { Role } from "@prisma/client";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { db } from "./db";
import { hasRole } from "./rbac";
import { logPermissionDenied } from "./audit-denied";

/**
 * SERVER TOMON QOROVULLARI (Punkt 1)
 *
 * Middleware faqat sahifa navigatsiyasini ushlaydi. Server Action'lar va
 * page.tsx'lar to'g'ridan-to'g'ri chaqirilishi mumkin — shuning uchun har bir
 * himoyalangan sahifa/action BOSHIDA shu funksiyalardan biri chaqirilishi shart.
 *
 * Namuna:
 *   const user = await requireRole("ADMIN");
 *   const user = await requireAuth();
 *
 * MUHIM: bu qorovullar "qaysi ROLGA ruxsat" degan savolga javob beradi.
 * "Qaysi QATORLARGA ruxsat" degan savol — src/lib/scope.ts (Punkt 2).
 * Ikkisi birga ishlatiladi.
 *
 * AUDIT (H4b): rol mos kelmasa, `/forbidden` ga yo'naltirishdan OLDIN
 * rad etish `AuditLog` ga `PERMISSION_DENIED` bilan yoziladi. Ilgari bu
 * holat hech qayerda iz qoldirmasdi — ya'ni boshqa rol sahifalarini
 * ketma-ket "sinab ko'rish" urinishini keyin aniqlashning imkoni yo'q edi.
 */

export type SessionUser = NonNullable<Session["user"]>;

/**
 * next-intl'ning redirect() funksiyasi ichida NEXT_REDIRECT xatosini tashlaydi,
 * ya'ni undan keyingi kod hech qachon bajarilmaydi. Ammo uning tip imzosi buni
 * TypeScript'ga bildirmaydi, natijada TS18047 ("possibly null") xatosi chiqadi.
 *
 * Shu yordamchi qaytish tipini `never` qilib belgilaydi — shundan keyin TS
 * narrowing to'g'ri ishlaydi va `as` / `!` kabi xavfli hiylalar kerak bo'lmaydi.
 */
export function redirectNever(path: string): never {
  redirect(path);
  // Bu yerga hech qachon yetib kelmaydi (redirect yuqorida throw qiladi).
  throw new Error(`Unreachable: redirect("${path}") did not throw`);
}

/**
 * SESSIYANING HALI HAM HAQIQIYLIGINI TEKSHIRADI (bazadan).
 * ========================================================
 *
 * Nima uchun kerak: sessiya JWT ko'rinishida — u serverda saqlanmaydi,
 * tokenning O'ZI kalit. Shuning uchun token berilgandan keyin sodir
 * bo'lgan hodisalar (parol almashtirildi, hisob bloklandi) tokenga
 * hech qanday ta'sir qilmaydi. U muddati tugaguncha (8 soat) ishlayveradi.
 *
 * Ikkita amaliy holat:
 *   1. O'qituvchi paroli o'g'irlanganini sezdi va parolni almashtirdi.
 *      Tekshiruvsiz — hujumchining brauzeridagi eski token ishlayverardi.
 *   2. Xodim ishdan bo'shatildi va hisobi bloklandi. `auth.ts` dagi
 *      davriy tekshiruv buni 30 daqiqagacha kechikish bilan sezardi.
 *
 * Endi ikkalasi ham DARHOL kuchga kiradi. Narxi — har so'rovda bitta
 * birlamchi kalit bo'yicha so'rov (~1 ms).
 *
 * Xato bo'lsa (baza javob bermasa) sessiya O'TKAZILMAYDI — fail-closed.
 * Ochiq qoldirgandan ko'ra ishlamagani yaxshi.
 */
async function assertSessionStillValid(user: SessionUser): Promise<void> {
  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { isActive: true, passwordChangedAt: true },
  });

  // Hisob o'chirilgan yoki bloklangan.
  if (!dbUser || !dbUser.isActive) {
    redirectNever("/login");
  }

  // Parol shu sessiya berilgandan KEYIN almashtirilgan — sessiya o'lik.
  if (
    dbUser.passwordChangedAt &&
    dbUser.passwordChangedAt.getTime() > (user.pwdAt ?? 0)
  ) {
    redirectNever("/login");
  }
}

/**
 * Sessiyani talab qiladi.
 * Sessiya yo'q bo'lsa — /login ga yo'naltiradi (bu yerdan keyin kod bajarilmaydi).
 */
export async function requireAuth(): Promise<SessionUser> {
  const session = await auth();

  if (!session?.user) {
    redirectNever("/login");
  }

  await assertSessionStillValid(session.user);

  return session.user;
}

/**
 * Berilgan rollardan birini talab qiladi.
 * Rol mos kelmasa — /forbidden (403) sahifasiga yo'naltiradi.
 *
 * Rad etish `AuditLog` ga yoziladi (H4b). Jurnalga faqat rol nomlari
 * tushadi — sahifa yo'li, IP va foydalanuvchi kiritmasi ATAYLAB yozilmaydi
 * (maxfiylik va log injection'dan himoya).
 *
 * @example
 * await requireRole("ADMIN");
 * await requireRole("ADMIN", "ACCOUNTANT");
 */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireAuth();

  if (!hasRole(user.role, roles)) {
    // Audit yozuvi yo'naltirishdan OLDIN: `redirectNever` ichida
    // NEXT_REDIRECT xatosi tashlanadi va undan keyingi kod hech qachon
    // bajarilmaydi. Jurnal xatosi esa rad etishni to'xtatmaydi —
    // `logPermissionDenied` hech qachon `throw` qilmaydi.
    await logPermissionDenied({
      userId: user.id,
      reason: "role",
      entity: "Page",
      meta: { role: user.role, allowedRoles: roles },
    });

    redirectNever("/forbidden");
  }

  return user;
}

/** Qisqartma: faqat ADMIN uchun. */
export async function requireAdmin(): Promise<SessionUser> {
  return requireRole("ADMIN");
}

/** Qisqartma: moliyaviy modullar (ADMIN yoki ACCOUNTANT). */
export async function requireFinance(): Promise<SessionUser> {
  return requireRole("ADMIN", "ACCOUNTANT");
}

/** Qisqartma: o'quv jarayoni (ADMIN yoki TEACHER). */
export async function requireTeaching(): Promise<SessionUser> {
  return requireRole("ADMIN", "TEACHER");
}
