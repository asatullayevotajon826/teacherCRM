import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { hasRole } from "@/lib/rbac";
import { logError } from "@/lib/logger";
import { logPermissionDenied } from "@/lib/audit-denied";
import { consume, ipFromHeaders } from "@/lib/rate-limit-core";

/**
 * API QOROVULI (majburiy!)
 * ========================
 *
 * MUAMMO: middleware `/api/auth/*` ni chetlab o'tadi va tarixan butun
 * `/api/*` ni umuman tekshirmasdi. Ya'ni yangi route handler yozgan odam
 * `requireRole` ni yozishni unutsa — u endpoint butunlay ochiq qolardi va
 * buni hech kim sezmasdi. Bitta unutilgan qator = butun bazani o'g'irlash.
 *
 * YECHIM: har bir route handler SHU wrapper orqali yoziladi. Ruxsat
 * tekshiruvi "esga tushirish" emas, tuzilmaning o'zi bo'ladi — wrapper'siz
 * handler yozib bo'lmaydi, chunki `roles` majburiy parametr.
 *
 * QOIDA (yangi sahifa/endpoint qo'shganda ham amal qiladi):
 *   src/app/api/** ostidagi HAR QANDAY route SHU funksiya bilan o'raladi.
 *
 * Qorovul ketma-ketligi:
 *   1. Sessiya bormi                      → yo'q bo'lsa 401
 *   2. Parol almashtirish majburiymi      → ha bo'lsa 403
 *   3. Rol ruxsat etilganlar ichidami     → yo'q bo'lsa 403
 *   4. So'rov cheklovi (foydalanuvchi+IP) → oshsa 429
 *   5. Handler ishlaydi, xatolari yashiriladi
 *
 * Javoblar ATAYLAB quruq: xato matni ichki tuzilma haqida hech nima aytmaydi
 * ("bunday o'quvchi yo'q" va "ruxsatingiz yo'q" farqlanmaydi — enumeration
 * hujumining oldi olinadi).
 *
 * AUDIT (H4b)
 * -----------
 * 2-, 3- va 4-qadamdagi rad etishlar `AuditLog` ga `PERMISSION_DENIED`
 * bilan yoziladi. Ilgari ular hech qanday doimiy iz qoldirmasdi: API ni
 * skript bilan "titib ko'rish" urinishi normal ishlashdan farq qilmasdi.
 *
 * 401 (sessiyasiz so'rov) ATAYLAB yozilmaydi: foydalanuvchi noma'lum,
 * ya'ni yozuvda foydali ma'lumot yo'q, lekin autentifikatsiyasiz hujumchi
 * uchun `AuditLog` ni cheksiz to'ldirish yo'li paydo bo'lardi. Bu holat
 * cheklov (`consume`) bilan to'siladi.
 *
 * Javob matni, status kodi va ketma-ketlik O'ZGARMADI — audit faqat
 * qo'shimcha yozuv, qaror emas.
 */

/** Bitta foydalanuvchi API'ni bombardimon qila olmasligi uchun. */
const ROUTE_RULE = { limit: 30, windowMs: 60_000 };

export type GuardedContext<TParams> = {
  request: Request;
  params: TParams;
  user: { id: string; role: Role };
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Next.js ichki boshqaruv xatolari (redirect/notFound) ushlanmasligi kerak. */
function isNextControlFlowError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

export function createRouteHandler<TParams extends Record<string, string>>(options: {
  /** Ruxsat etilgan rollar. Bo'sh massiv berilmaydi — kamida bitta rol. */
  roles: [Role, ...Role[]];
  handler: (ctx: GuardedContext<TParams>) => Promise<Response>;
}) {
  return async function guardedRoute(
    request: Request,
    context: { params: TParams }
  ): Promise<Response> {
    const session = await auth();
    const user = session?.user;

    if (!user?.id) {
      return jsonError(401, "Kirish talab qilinadi.");
    }

    if (user.mustChangePassword) {
      // Jurnalga yo'l (`pathname`) ham yozilmaydi: u foydalanuvchi
      // boshqaradigan qiymat va jurnalga o'zboshimcha matn kiritish
      // yo'lini ochardi. Yo'l kerak bo'lsa `logError` orqali serverda
      // qoladi (pastdagi `catch`).
      await logPermissionDenied({
        userId: user.id,
        reason: "mustChangePassword",
        entity: "Route",
        meta: { role: user.role },
      });
      return jsonError(403, "Avval parolni almashtiring.");
    }

    if (!hasRole(user.role, options.roles)) {
      await logPermissionDenied({
        userId: user.id,
        reason: "role",
        entity: "Route",
        meta: { role: user.role, allowedRoles: options.roles },
      });
      return jsonError(403, "Ruxsat yo'q.");
    }

    const ip = ipFromHeaders(request.headers);
    if (!consume(`route:${user.id}:${ip}`, ROUTE_RULE)) {
      // IP jurnalga YOZILMAYDI — shaxsiy ma'lumot, `AuditLog` esa uzoq
      // saqlanadi va ko'p odam ko'radi.
      await logPermissionDenied({
        userId: user.id,
        reason: "rateLimit",
        entity: "Route",
        meta: {
          role: user.role,
          limit: ROUTE_RULE.limit,
          windowMs: ROUTE_RULE.windowMs,
        },
      });
      return jsonError(429, "So'rovlar juda ko'p. Birozdan keyin urinib ko'ring.");
    }

    try {
      const response = await options.handler({
        request,
        params: context.params,
        user: { id: user.id, role: user.role as Role },
      });

      if (!response.headers.has("Cache-Control")) {
        response.headers.set("Cache-Control", "no-store");
      }
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch (error) {
      if (isNextControlFlowError(error)) throw error;

      // DIQQAT: bu yerga xom `error` obyektini BERIB BO'LMAYDI.
      //
      // Ilgari shunday edi: console.error("[route-guard] ...", error)
      // Prisma xato matniga so'rovdagi qiymatlarni (email, hash) va ba'zan
      // `DATABASE_URL` ni qo'shadi. Prod loglari Vercel/Sentry ga uzatiladi
      // — ya'ni bazadagi qiymat loyihadan tashqariga chiqib ketardi.
      //
      // `logError` prod'da strukturaviy JSON yozadi va `message` ni
      // `sanitizeErrorMessage` dan o'tkazadi (url/email/hash/telefon).
      logError("route-guard", error, { path: new URL(request.url).pathname });

      return jsonError(500, "Amal bajarilmadi. Qayta urinib ko'ring.");
    }
  };
}
