import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireRole, type SessionUser } from "./auth-guard";
import { logAudit, type AuditAction } from "./audit";
import { logError } from "./logger";
import { consume } from "./rate-limit-core";
import { getRequestIp } from "./rate-limit";

/**
 * SERVER ACTION QATLAMI (Punkt 3)
 * ===============================
 *
 * Server Action — ochiq HTTP endpoint. Brauzer konsolidan yoki `curl` bilan
 * unga istalgan ma'lumot yuborilishi mumkin. Formadagi `<select>` da 3 ta
 * variant borligi hech narsani kafolatlamaydi.
 *
 * Har bir action OLTITA qatlamdan o'tishi SHART:
 *   1. Rol tekshiruvi     — requireAuth / requireRole
 *   2. So'rov cheklovi    — foydalanuvchi + IP bo'yicha (pastdagi izoh)
 *   3. Kirish validatsiyasi — zod (istisno yo'q)
 *   4. Xato xavfsizligi   — texnik detal foydalanuvchiga chiqmaydi
 *   5. Audit jurnali      — CREATE / UPDATE / DELETE avtomatik
 *   6. Kuzatuv (PR G3)    — har bir rad etish/xato serverda qayd etiladi
 *
 * Auth tekshiruvi validatsiyadan OLDIN: kirmagan odamga sxema tafsiloti sizib chiqmasin.
 *
 * 6-QATLAM NEGA QO'SHILDI (PR G3)
 * -------------------------------
 * Ilgari bu fayldagi har bir `catch` xatoni **butunlay jim** yutib yuborardi:
 * foydalanuvchiga "Amal bajarilmadi" chiqardi, server esa hech qayerga
 * hech narsa yozmasdi. Bu ikki tomondan xavfli edi:
 *
 *   1. HUJUMNI KO'RMASLIK. Skript bilan qilinayotgan hujum aynan shu
 *      yo'llardan o'tadi — sxemani buzadigan yuzlab so'rov, rad etilgan
 *      rol urinishlari, cheklovga urilishlar. Hammasi jim bo'lsa, hujum
 *      normal ishlashdan farq qilmaydi: log'da bo'sh, grafikda bo'sh.
 *      Ya'ni "teshik yo'q" degan xulosani ham, "hujum bo'lmadi" degan
 *      xulosani ham ISBOTLAB bo'lmaydi.
 *   2. NOSOZLIKNI TOPOLMASLIK. Ish joyida "saqlanmadi" degan shikoyat
 *      kelsa, sababni aniqlashning imkoni yo'q edi — iz qolmagan.
 *
 * Endi har bir rad etish va xato `logError` orqali qayd etiladi. `logError`
 * xato matnini `sanitizeErrorMessage` dan o'tkazadi (email, telefon, bcrypt
 * xeshi, `DATABASE_URL` o'chiriladi), `meta` ni `redactMeta` tozalaydi.
 * Foydalanuvchiga ko'rinadigan xabar esa O'ZGARMADI — texnik detal, sxema
 * tafsiloti va Prisma kodlari hamon tashqariga chiqmaydi.
 */

export type ActionOk<T> = { ok: true; data: T };
export type ActionErr = { ok: false; error: string };
export type ActionResult<T = void> = ActionOk<T> | ActionErr;

/**
 * SERVER ACTION SO'ROV CHEKLOVI
 * ============================
 *
 * Middleware sahifa va `/api` so'rovlarini cheklaydi, lekin Server Action
 * chaqiruvi oddiy POST bo'lib SHU SAHIFANING o'z manzili ustidan ketadi.
 * Ya'ni action'lar sahifa chegarasidan foydalanadi — u esa RSC prefetch
 * uchun ataylab keng (300/min). Natijada skript bilan minglab yozish
 * so'rovini yuborish yo'li ochiq qolgan edi:
 *   - parol almashtirishni ketma-ket sinash,
 *   - baho/davomatni tsiklda qayta yozib bazani ko'mib tashlash,
 *   - Excel importni takrorlab serverni band qilish.
 *
 * Kalit: foydalanuvchi + IP. Faqat IP bo'yicha cheklash bitta maktab
 * tarmog'idagi hamma o'qituvchini birga bloklab qo'yardi (NAT orqasida
 * IP bir xil). Faqat foydalanuvchi bo'yicha cheklash esa bir nechta
 * hisobni parallel ishlatib chetlab o'tishga imkon berardi.
 *
 * Chegara yozish tezligiga qarab tanlandi: eng og'ir sahifa — jurnal, unda
 * o'qituvchi bir sinfni bir marta saqlaydi. Daqiqada 40 ta yozish amali
 * odam uchun yetarlidan ko'p, skript uchun esa juda kam.
 *
 * ESLATMA (bitta jarayon chegarasi): hisoblagich xotirada turadi. Bir
 * nechta instansiyada ishlaganda umumiy hisob kerak (Redis) — buni
 * `docs/07-xavfsizlik.md` da ma'lum cheklov sifatida yozib qo'yamiz.
 */
const ACTION_RULE = { limit: 40, windowMs: 60_000 };

const RATE_LIMIT_MESSAGE =
  "So'rovlar juda ko'p. Bir daqiqadan keyin urinib ko'ring.";

/**
 * Next.js `redirect()` / `notFound()` ichida tashlanadigan boshqaruv xatosi.
 * Buni yutib yuborish mumkin emas — aks holda yo'naltirish ishlamaydi.
 */
function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = "digest" in error ? error.digest : undefined;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))
  );
}

/**
 * Prisma xato kodini foydalanuvchiga ko'rsatiladigan xabarga aylantiradi.
 * Kodning o'zi (P2002 va h.k.) hech qachon chiqmaydi.
 */
export function prismaErrorMessage(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return "Bu qiymat allaqachon mavjud.";
      case "P2025":
        return "Yozuv topilmadi.";
      case "P2003":
        return "Bog'liq yozuv topilmadi.";
      default:
        return "Ma'lumotlar bazasi xatosi.";
    }
  }
  return null;
}

/** FormData ni oddiy obyektga aylantiradi. Fayllar tashlab ketiladi. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue;

    if (key in obj) {
      const existing = obj[key];
      obj[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      obj[key] = value;
    }
  }

  return obj;
}

type AuditConfig<TInput, TResult> = {
  action: AuditAction;
  entity: string;
  entityId?: (
    input: TInput,
    result: TResult,
    user: SessionUser
  ) => string | null | undefined;
  meta?: (
    input: TInput,
    result: TResult,
    user: SessionUser
  ) => Record<string, unknown> | null;
};

type SafeActionOptions<TSchema extends z.ZodTypeAny, TResult> = {
  /** Bo'sh bo'lsa faqat requireAuth. Berilsa requireRole. */
  roles?: Role[];
  schema: TSchema;
  /** NoInfer: TResult faqat handler qaytishidan olinadi, audit callbackdan emas. */
  audit?: AuditConfig<z.infer<TSchema>, NoInfer<TResult>>;
  handler: (input: z.infer<TSchema>, user: SessionUser) => Promise<TResult>;
  /**
   * So'rov cheklovi qoidasi. Sukut bo'yicha ACTION_RULE.
   * Cheklovni BUTUNLAY o'chirish imkoni ataylab berilmagan.
   */
  rateLimit?: { limit: number; windowMs: number };
};

/**
 * Log yozuvlarida action'ni ajratish uchun nom.
 *
 * Audit sozlamasi bo'lsa — "action:Grade:UPDATE" ko'rinishida, aks holda
 * shunchaki "action". Bu nom log'da qidirish uchun ishlatiladi, shuning
 * uchun unga foydalanuvchi kiritgan hech narsa QO'SHILMAYDI (aks holda
 * log'ga o'zboshimcha matn kiritish yo'li ochilardi).
 */
function scopeOf<TSchema extends z.ZodTypeAny, TResult>(
  options: SafeActionOptions<TSchema, TResult>
): string {
  return options.audit
    ? `action:${options.audit.entity}:${options.audit.action}`
    : "action";
}

/**
 * Server Action yaratadi: rol → cheklov → zod → handler → audit.
 */
export function createAction<TSchema extends z.ZodTypeAny, TResult>(
  options: SafeActionOptions<TSchema, TResult>
) {
  const scope = scopeOf(options);

  return async (raw: unknown): Promise<ActionResult<TResult>> => {
    let user: SessionUser;
    try {
      user = options.roles?.length
        ? await requireRole(...options.roles)
        : await requireAuth();
    } catch (error) {
      if (isNextControlFlowError(error)) throw error;

      // Bu yerga yetib kelish NORMAL EMAS: ruxsat yo'qligi `redirect()`
      // bilan hal bo'ladi (u yuqorida qaytib ketadi). Demak bu haqiqiy
      // nosozlik — masalan baza javob bermayapti va sessiyani tekshirib
      // bo'lmadi. Ilgari bu holat butunlay jim edi: foydalanuvchi
      // "Kirish talab qilinadi" ko'rib, hisobim buzildi deb o'ylardi,
      // haqiqiy sabab esa hech qayerga yozilmasdi.
      logError(scope, error, { stage: "auth", roles: options.roles ?? null });
      return { ok: false, error: "Kirish talab qilinadi." };
    }

    // 2-qatlam: so'rov cheklovi. Rol tekshiruvidan KEYIN — kalitda
    // foydalanuvchi ID si bo'lishi kerak; kirmagan so'rov esa yuqorida
    // allaqachon to'xtatilgan.
    const ip = await getRequestIp();
    if (
      !consume(`action:${user.id}:${ip}`, options.rateLimit ?? ACTION_RULE)
    ) {
      // Cheklovga urilish — xato emas, lekin XAVFSIZLIK SIGNALI.
      // Oddiy foydalanuvchi daqiqada 40 ta yozish amalini bajarmaydi;
      // bu chegaraga urilgan hisob deyarli har doim skript (yoki
      // o'g'irlangan sessiya) bo'ladi. Shuning uchun qayd etiladi —
      // aks holda hujum urinishi umuman iz qoldirmasdi.
      logError(scope, new Error("so'rov cheklovi ishga tushdi"), {
        stage: "rateLimit",
        userId: user.id,
        role: user.role,
      });
      return { ok: false, error: RATE_LIMIT_MESSAGE };
    }

    const parsed = options.schema.safeParse(raw);
    if (!parsed.success) {
      /**
       * Sxemadan o'tmagan so'rov — ikkinchi xavfsizlik signali.
       *
       * Normal foydalanuvchi interfeysi orqali bunday so'rov deyarli
       * yubormaydi (forma o'zi tekshiradi). Ya'ni bu ko'pincha qo'lda
       * yasalgan so'rov — sxemani "sinab ko'rish" urinishi.
       *
       * DIQQAT — FAQAT MAYDON NOMLARI VA XATO TURI yoziladi, QIYMATLAR
       * EMAS. Aks holda log'ga parol, telefon, baho kabi qiymatlar
       * tushardi: hujumchi ataylab parolni noto'g'ri maydonga yuborib,
       * uni log faylida ochiq matnda "saqlab qo'yishi" mumkin edi.
       */
      logError(scope, new Error("kirish ma'lumoti sxemadan o'tmadi"), {
        stage: "validation",
        userId: user.id,
        issues: parsed.error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      });
      return { ok: false, error: "Ma'lumotlar noto'g'ri. Qayta tekshiring." };
    }

    try {
      const data = await options.handler(parsed.data, user);

      if (options.audit) {
        await logAudit({
          userId: user.id,
          action: options.audit.action,
          entity: options.audit.entity,
          entityId:
            options.audit.entityId?.(parsed.data, data, user) ?? null,
          meta: options.audit.meta?.(parsed.data, data, user) ?? null,
        });
      }

      return { ok: true, data };
    } catch (error) {
      if (isNextControlFlowError(error)) throw error;

      const mapped = prismaErrorMessage(error);

      // Eng muhim joy: ilgari HAR QANDAY xato shu yerda izsiz yo'qolardi.
      // Endi sabab serverda qoladi, foydalanuvchiga esa avvalgidek faqat
      // umumiy xabar chiqadi — ikkisi bir-biriga zid emas.
      logError(scope, error, {
        stage: "handler",
        userId: user.id,
        // `mapped` — bu foydalanuvchiga qanday xabar ketganini bilish uchun.
        // Prisma kodining o'zi emas, shuning uchun maxfiy ma'lumot yo'q.
        userMessage: mapped ?? "umumiy",
      });

      return {
        ok: false,
        error: mapped ?? "Amal bajarilmadi. Qayta urinib ko'ring.",
      };
    }
  };
}

/**
 * `<form action={...}>` uchun: FormData ni obyektga aylantirib createAction ga beradi.
 * React form action `void | Promise<void>` kutadi — natijani qaytarmaymiz.
 * Natija kerak bo'lsa `createAction` ishlating.
 */
export function createFormAction<TSchema extends z.ZodTypeAny, TResult>(
  options: SafeActionOptions<TSchema, TResult>
) {
  const run = createAction(options);
  return async (formData: FormData): Promise<void> => {
    await run(formDataToObject(formData));
  };
}
