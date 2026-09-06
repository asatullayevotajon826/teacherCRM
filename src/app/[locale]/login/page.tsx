import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { LoginForm } from "./login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { GraduationCap } from "lucide-react";

// Auth (cookies) va next-intl sabab dinamik render
export const dynamic = "force-dynamic";

const demoAccounts = [
  { role: "ADMIN", login: "admin@maktab.uz" },
  { role: "TEACHER", login: "teacher@maktab.uz" },
  { role: "ACCOUNTANT", login: "accountant@maktab.uz" },
  { role: "PARENT", login: "parent@maktab.uz" },
];

/**
 * DEMO HISOBLAR FAQAT ISHLAB CHIQISH MUHITIDA KO'RSATILADI
 * =======================================================
 *
 * Ilgari bu ro'yxat login sahifasida HAR DOIM ko'rinardi. Login sahifasi
 * esa ochiq (autentifikatsiya talab qilmaydi) — ya'ni istalgan odam
 * `admin@maktab.uz` amaldagi ADMIN login'i ekanini bilib olardi.
 *
 * NEGA XAVFLI:
 *   1. `auth.ts` da user enumeration'ga qarshi maxsus himoya bor
 *      (soxta xesh bilan `bcrypt.compare`, javob vaqti bir xil). Bu
 *      ro'yxat o'sha himoyani ma'nosiz qilardi — hujumchi hech narsa
 *      o'lchashi kerak emas, login sahifada yozib turadi.
 *   2. Brute force endi nishonli: login ma'lum, faqat parol qoladi.
 *      Chegara 5 urinish / 15 daqiqa — lekin sekin va uzoq davom
 *      etadigan hujum uchun bu to'siq emas.
 *   3. Fishing uchun tayyor manzil.
 *   4. Seed real bazada bir marta ishlatilgan bo'lsa (yoki
 *      `SEED_ALLOW_REMOTE=1` bilan), bu hisoblar HAQIQATAN mavjud
 *      bo'ladi — `SEED_PASSWORD` esa jamoada tarqalgan bo'lishi mumkin.
 *
 * `process.env.NODE_ENV` Next.js tomonidan build paytida almashtiriladi,
 * shuning uchun ishlab chiqarish build'ida bu blok bundle'ga umuman
 * tushmaydi — HTML manbasini ko'rgan ham hech narsa topmaydi.
 *
 * Demo hisoblar kerak bo'lsa: `npm run dev` yoki lokal `npm start`
 * (NODE_ENV=production bo'lmagan holat).
 */
const showDemoAccounts = process.env.NODE_ENV !== "production";

export default async function LoginPage() {
  // Allaqachon kirgan bo'lsa — dashboardga
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  const t = await getTranslations("login");
  const tr = await getTranslations("roles");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/40 p-4">
      {/*
        Til almashtirgich kartadan TASHQARIDA va yuqorida turadi: kirmagan
        foydalanuvchi ham tilni tanlashi kerak. Ilgari almashtirgich faqat
        ilova ichidagi sarlavhada edi — ya'ni ruszabon foydalanuvchi login
        sahifasini o'zbekcha ko'rar va tilni faqat URL'ni qo'lda tahrirlab
        (`/uz/login` → `/ru/login`) o'zgartira olardi.
      */}
      <div className="flex w-full max-w-md justify-end">
        <LanguageSwitcher />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <GraduationCap className="h-6 w-6" />
          </div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <LoginForm />

          {showDemoAccounts ? (
            <div className="rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
              <p className="mb-2 font-medium text-foreground">
                {t("demoTitle")}
              </p>
              <ul className="space-y-1">
                {demoAccounts.map((acc) => (
                  <li key={acc.login} className="flex justify-between gap-2">
                    <span>{tr(acc.role)}</span>
                    <code className="text-foreground">{acc.login}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
