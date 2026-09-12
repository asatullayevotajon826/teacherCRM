import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Role, Locale } from "@prisma/client";
import { authConfig } from "@/auth.config";
import { db } from "@/lib/db";
import { logAudit, maskIdentifier } from "@/lib/audit";
import { logError } from "@/lib/logger";
import {
  clearLoginFailures,
  getRequestIp,
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/rate-limit";

/**
 * TO'LIQ AUTH (faqat Node runtime: sahifalar, server action'lar, API)
 * ==================================================================
 * Middleware bu faylni ISHLATMAYDI — u `auth.config.ts` dan foydalanadi,
 * chunki edge runtime'da Prisma va bcrypt ishlamaydi. Tafsilotlar shu
 * fayl izohida.
 *
 * ESLATMA (PR G4b): login cheklovi funksiyalari endi bazaga murojaat
 * qiladi, ya'ni asinxron. Ular ATAYLAB `await` bilan chaqiriladi —
 * `await` tushib qolsa hisob yozilmasdan qolib, parol sinashga qarshi
 * himoya jimgina ishlamay qolardi.
 */

// Login formasi validatsiyasi
const credentialsSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
});

const BCRYPT_ROUNDS = 10;

/**
 * HISOB MAVJUDLIGINI ANIQLASHGA QARSHI (user enumeration)
 * =======================================================
 *
 * Muammo: hisob topilmaganda parolni taqqoslashning hojati yo'qdek
 * ko'rinadi. Lekin `bcrypt.compare` ataylab sekin (~100 ms), shuning uchun
 * "hisob yo'q" javobi "parol xato" javobidan sezilarli TEZ qaytadi.
 *
 * Hujumchi xabar matnini emas, javob VAQTINI o'lchaydi va shu farq bilan
 * qaysi email/telefon tizimda ro'yxatdan o'tganini aniqlaydi. Natijada
 * maktabning haqiqiy foydalanuvchilari ro'yxati yig'iladi — bu fishing
 * xati yuborish uchun tayyor material. Login cheklovi buni to'xtatmaydi:
 * chegaraga yetmasdan ham bir necha o'nlab manzilni sinab ko'rish mumkin.
 *
 * Yechim: hisob topilmasa ham soxta xesh bilan taqqoslash bajariladi.
 * Ikkala yo'l ham bir xil vaqt oladi.
 *
 * Xesh bir marta hisoblanadi va xotirada qoladi. Uni qo'lda yozib
 * qo'ymadim — noto'g'ri formatdagi xesh bilan `compare` darhol `false`
 * qaytaradi va butun himoya jimgina ishlamay qoladi.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(
      "vaqt-hujumiga-qarshi-soxta-parol",
      BCRYPT_ROUNDS
    );
  }
  return dummyHashPromise;
}

/**
 * DB dan isActive/role qayta o'qish oralig'i: 30 daqiqa.
 *
 * Bu "bloklash qancha vaqtda kuchga kiradi" degan savolning javobi.
 * JWT sessiyasi o'zi-o'zicha yashaydi (serverda saqlanmaydi), shuning
 * uchun hisobni o'chirganda tokendan darhol xabar bormaydi — aynan shu
 * davriy tekshiruv bloklashni ishlatadi.
 *
 * Oraliqni juda uzoq qilish (masalan 6 soat) bloklashni amalda
 * foydasiz qiladi: sessiya umri 8 soat, ya'ni bo'shatilgan o'qituvchi
 * ish kunining oxirigacha tizimda qolaverardi.
 *
 * ESLATMA: sahifalar va server action'lar uchun asosiy qalqon endi
 * `requireAuth` ichidagi tekshiruv — u HAR so'rovda bazaga qaraydi va
 * bloklash ham, parol almashtirish ham darhol kuchga kiradi. Bu davriy
 * tekshiruv ikkinchi qatlam bo'lib qoladi (masalan `auth()` to'g'ridan
 * chaqirilgan joylar uchun).
 */
const JWT_RECHECK_MS = 30 * 60 * 1000;

/** Baza uzluksiz javob bermasa, sessiyani shu muddatdan keyin bekor qilamiz. */
const RECHECK_GRACE_MS = 2 * 60 * 60 * 1000;

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        login: { label: "Email yoki telefon", type: "text" },
        password: { label: "Parol", type: "password" },
      },
      authorize: async (raw) => {
        const ip = await getRequestIp();
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          await logAudit({
            action: "LOGIN_FAILED",
            entity: "User",
            meta: { reason: "invalid_input" },
          });
          return null;
        }

        const { login, password } = parsed.data;

        if (await isLoginRateLimited(login, ip)) {
          await logAudit({
            action: "LOGIN_FAILED",
            entity: "User",
            meta: {
              reason: "rate_limited",
              login: maskIdentifier(login),
            },
          });
          return null;
        }

        const user = await db.user.findFirst({
          where: {
            isActive: true,
            OR: [{ email: login }, { phone: login }],
          },
        });
        if (!user) {
          // Vaqtni tenglashtirish uchun — natijasi ataylab ishlatilmaydi.
          await bcrypt.compare(password, await getDummyHash());

          await recordLoginFailure(login, ip);
          await logAudit({
            action: "LOGIN_FAILED",
            entity: "User",
            meta: { login: maskIdentifier(login) },
          });
          return null;
        }

        const passwordOk = await bcrypt.compare(password, user.passwordHash);
        if (!passwordOk) {
          await recordLoginFailure(login, ip);
          await logAudit({
            userId: user.id,
            action: "LOGIN_FAILED",
            entity: "User",
            entityId: user.id,
            meta: { login: maskIdentifier(login) },
          });
          return null;
        }

        await clearLoginFailures(login);

        return {
          id: user.id,
          name: user.fullName,
          email: user.email ?? undefined,
          role: user.role,
          locale: user.locale,
          mustChangePassword: user.mustChangePassword,
          // Shu sessiya QAYSI parol uchun berilayotgani.
          pwdAt: user.passwordChangedAt
            ? user.passwordChangedAt.getTime()
            : 0,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.locale = user.locale;
        token.mustChangePassword = user.mustChangePassword;
        // FAQAT shu yerda — kirish paytida — yoziladi va boshqa hech
        // qachon yangilanmaydi. Agar quyidagi davriy tekshiruvda uni
        // bazadagi yangi qiymat bilan almashtirsak, o'g'irlangan token
        // o'zini "yangi parol bilan berilgan" qilib ko'rsatib, chiqarib
        // yuborilishdan qutulib qolardi.
        token.pwdAt = typeof user.pwdAt === "number" ? user.pwdAt : 0;
        token.checkedAt = Date.now();
        return token;
      }

      const checkedAt = typeof token.checkedAt === "number" ? token.checkedAt : 0;
      if (Date.now() - checkedAt < JWT_RECHECK_MS) {
        return token;
      }

      const userId = typeof token.sub === "string" ? token.sub : null;
      if (!userId) {
        logError("auth.session_invalidated", new Error("token.sub yo'q"));
        return null;
      }

      /*
       * MUHIM: bu yerda `null` qaytarish = foydalanuvchini tizimdan chiqarish.
       * Shu sababli faqat ANIQ sabab bo'lganda (hisob yo'q yoki o'chirilgan)
       * null qaytaramiz. Baza vaqtincha javob bermasa sessiyani buzmaymiz.
       */
      let dbUser: {
        isActive: boolean;
        role: Role;
        locale: Locale;
        mustChangePassword: boolean;
        passwordChangedAt: Date | null;
      } | null = null;

      try {
        dbUser = await db.user.findUnique({
          where: { id: userId },
          select: {
            isActive: true,
            role: true,
            locale: true,
            mustChangePassword: true,
            passwordChangedAt: true,
          },
        });
      } catch (error) {
        logError("auth.jwt_recheck_failed", error);

        // Grace davri ichida eski token bilan davom etamiz.
        if (Date.now() - checkedAt < RECHECK_GRACE_MS) {
          return token;
        }
        logError("auth.session_invalidated", new Error("grace davri tugadi"));
        return null;
      }

      if (!dbUser) {
        // Masalan baza qayta seed qilingan — eski token endi hech kimga tegishli emas.
        logError("auth.session_invalidated", new Error("hisob topilmadi"));
        return null;
      }

      if (!dbUser.isActive) {
        logError("auth.session_invalidated", new Error("hisob bloklangan"));
        return null;
      }

      // Parol shu token berilgandan keyin almashtirilgan — token o'lik.
      const tokenPwdAt = typeof token.pwdAt === "number" ? token.pwdAt : 0;
      if (
        dbUser.passwordChangedAt &&
        dbUser.passwordChangedAt.getTime() > tokenPwdAt
      ) {
        logError("auth.session_invalidated", new Error("parol almashtirilgan"));
        return null;
      }

      token.role = dbUser.role;
      token.locale = dbUser.locale;
      token.mustChangePassword = dbUser.mustChangePassword;
      token.checkedAt = Date.now();
      return token;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await logAudit({
        userId: user.id,
        action: "LOGIN",
        entity: "User",
        entityId: user.id,
      });
    },
    async signOut(message) {
      const userId =
        "token" in message && typeof message.token?.sub === "string"
          ? message.token.sub
          : null;

      await logAudit({
        userId,
        action: "LOGOUT",
        entity: "User",
        entityId: userId,
      });
    },
  },
});
