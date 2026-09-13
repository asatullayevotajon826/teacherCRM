import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { redirectNever, type SessionUser } from "./auth-guard";
import { logPermissionDenied } from "./audit-denied";

/**
 * MA'LUMOT DARAJASIDAGI DOIRA — IDOR himoyasi (Punkt 2)
 * ====================================================
 *
 * Rol tekshiruvi YETARLI EMAS. `requireRole("TEACHER")` faqat "bu odam
 * o'qituvchimi?" degan savolga javob beradi. Lekin o'qituvchi BOSHQA sinf
 * o'quvchisini ko'rmasligi, ota-ona BOSHQA oila farzandini ko'rmasligi kerak.
 *
 * Hujum ko'rinishi (IDOR — Insecure Direct Object Reference):
 *   /uz/students/abc123  →  ID ni boshqasiga o'zgartirib ko'rish
 * Rol to'g'ri bo'lgani uchun qorovul o'tkazib yuboradi va begona bolaning
 * ma'lumoti ochiladi. Shuning uchun har bir so'rov DOIRA bilan cheklanadi.
 *
 * OLTIN QOIDA
 * -----------
 * Hech qachon yolg'iz `findUnique({ where: { id } })` ishlatilmaydi.
 * Doim ikkisidan biri:
 *   1) Ro'yxat uchun — `where: { AND: [filtr, studentScope(user)] }`
 *   2) Bitta yozuv uchun — `await assertCanAccessStudent(user, id)`
 *
 * FAIL-CLOSED tamoyili
 * --------------------
 * Rol notanish yoki ID yo'q bo'lsa — doira HECH NARSANI qaytarmaydi
 * (`{ id: { in: [] } }`). Ya'ni xato holatda ruxsat kengaymaydi, torayadi.
 *
 * ADMIN QOIDASI
 * -------------
 * Egasining qat'iy talabi: ADMIN hamma narsani ko'radi va hamma amalni
 * bajaradi. Shuning uchun har bir doira funksiyasining BIRINCHI sharti
 * `ADMIN` bo'lib, bo'sh filtr (`{}`) qaytaradi. Yangi doira yozganda shu
 * tartib saqlanadi. Lekin ADMIN ham auditdan o'tadi.
 *
 * Bu fayl "qaysi QATORLAR" savoliga javob beradi.
 * "Qaysi ROL" savoli — src/lib/auth-guard.ts. Ikkisi birga ishlatiladi.
 */

/** Hech bir qatorga mos kelmaydigan filtr (fail-closed uchun). */
const MATCH_NOTHING = { id: { in: [] as string[] } };

/**
 * Sessiyadan foydalanuvchi ID sini xavfsiz oladi.
 * ID bo'lmasligi — kutilmagan holat, shuning uchun jim o'tkazib yubormaymiz.
 */
function requireUserId(user: SessionUser): string {
  if (!user.id) {
    throw new Error("Sessiyada foydalanuvchi ID si yo'q — doira hisoblanmaydi");
  }
  return user.id;
}

// ------------------------------------------------------------------
// Doira funksiyalari — Prisma `where` qaytaradi
// ------------------------------------------------------------------

/**
 * O'quvchilar doirasi.
 *
 * - ADMIN — hammasi
 * - ACCOUNTANT — hammasi, lekin FAQAT O'QISH (TZ 2.1 bo'yicha 👁).
 *   Yozish huquqi bu yerda emas, `requireRole` bilan cheklanadi — buxgalter
 *   chaqiradigan action'larda ACCOUNTANT ro'yxatga kiritilmaydi.
 * - TEACHER — o'zi sinf rahbari bo'lgan, yoki o'zi dars beradigan sinflar
 * - PARENT — faqat o'z farzandlari (Guardian orqali)
 */
export function studentScope(user: SessionUser): Prisma.StudentWhereInput {
  switch (user.role) {
    case "ADMIN":
    case "ACCOUNTANT":
      return {};

    case "TEACHER": {
      const userId = requireUserId(user);
      return {
        class: {
          OR: [
            { homeroomTeacher: { userId } },
            { lessons: { some: { teacher: { userId } } } },
          ],
        },
      };
    }

    case "PARENT":
      return { guardian: { userId: requireUserId(user) } };

    default:
      return MATCH_NOTHING;
  }
}

/** Sinflar doirasi. */
export function classScope(user: SessionUser): Prisma.ClassWhereInput {
  switch (user.role) {
    case "ADMIN":
    case "ACCOUNTANT":
      return {};

    case "TEACHER": {
      const userId = requireUserId(user);
      return {
        OR: [
          { homeroomTeacher: { userId } },
          { lessons: { some: { teacher: { userId } } } },
        ],
      };
    }

    case "PARENT":
      return {
        students: { some: { guardian: { userId: requireUserId(user) } } },
      };

    default:
      return MATCH_NOTHING;
  }
}

/**
 * Darslar doirasi (KO'RISH va DAVOMAT uchun).
 *
 * 5-bosqich tuzatishi: sinf rahbari ham o'z sinfining BARCHA darslariga
 * yetishi kerak. Amalda davomatni ko'pincha sinf rahbari yuritadi, lekin u
 * har bir fanni o'zi o'qitmaydi.
 *
 * DIQQAT: bu doira BAHO uchun ishlatilmaydi — pastdagi `gradingLessonScope`
 * ga qaralsin.
 */
export function lessonScope(user: SessionUser): Prisma.LessonWhereInput {
  switch (user.role) {
    case "ADMIN":
      return {};

    case "TEACHER": {
      const userId = requireUserId(user);
      return {
        OR: [
          { teacher: { userId } },
          { class: { homeroomTeacher: { userId } } },
        ],
      };
    }

    case "PARENT":
      return {
        class: {
          students: { some: { guardian: { userId: requireUserId(user) } } },
        },
      };

    default:
      return MATCH_NOTHING;
  }
}

/**
 * BAHO QO'YISH uchun darslar doirasi (6-bosqich).
 *
 * Egasining qat'iy talabi: bahoni FAQAT FAN O'QITUVCHISI qo'yadi. Sinf
 * rahbari o'z sinfining boshqa fanidan baho qo'ya OLMAYDI — davomatdan
 * farqli qoida.
 *
 * Shuning uchun bu doira `lessonScope` dan alohida yozilgan va unda
 * `homeroomTeacher` shoxi ATAYLAB yo'q. Ikkisini birlashtirish yoki bu yerga
 * homeroom qo'shish — xavfsizlik xatosi hisoblanadi.
 *
 * PARENT va ACCOUNTANT bu yerda umuman yo'q → `MATCH_NOTHING` (fail-closed):
 * ular hech qanday darsga baho qo'ya olmaydi.
 */
export function gradingLessonScope(
  user: SessionUser
): Prisma.LessonWhereInput {
  switch (user.role) {
    case "ADMIN":
      return {};

    case "TEACHER":
      return { teacher: { userId: requireUserId(user) } };

    default:
      return MATCH_NOTHING;
  }
}

// Quyidagilar o'quvchi doirasidan kelib chiqadi — mantiq bitta joyda turadi,
// shuning uchun studentScope o'zgarsa hammasi avtomatik moslashadi.

/** Davomat doirasi. */
export function attendanceScope(
  user: SessionUser
): Prisma.AttendanceWhereInput {
  return { student: studentScope(user) };
}

/**
 * Baholar doirasi (KO'RISH uchun).
 *
 * Ko'rish keng: sinf rahbari va ota-ona bahoni ko'rishi kerak. Lekin YOZISH
 * `gradingLessonScope` bilan cheklanadi. Ko'rish va yozish doirasi bu modulda
 * ataylab bir xil emas.
 */
export function gradeScope(user: SessionUser): Prisma.GradeWhereInput {
  return { student: studentScope(user) };
}

/** Jarima ballar doirasi. */
export function penaltyScope(user: SessionUser): Prisma.PenaltyWhereInput {
  return { student: studentScope(user) };
}

/** Test natijalari doirasi. */
export function testResultScope(
  user: SessionUser
): Prisma.TestResultWhereInput {
  return { student: studentScope(user) };
}

/** Kontraktlar doirasi. */
export function contractScope(user: SessionUser): Prisma.ContractWhereInput {
  return { student: studentScope(user) };
}

/** Hisob-fakturalar doirasi (Contract orqali o'quvchiga bog'lanadi). */
export function invoiceScope(user: SessionUser): Prisma.InvoiceWhereInput {
  return { contract: { student: studentScope(user) } };
}

/** To'lovlar doirasi (Invoice → Contract → Student). */
export function paymentScope(user: SessionUser): Prisma.PaymentWhereInput {
  return { invoice: { contract: { student: studentScope(user) } } };
}

// ------------------------------------------------------------------
// Bitta yozuvga kirishni tekshirish
// ------------------------------------------------------------------

/**
 * Bu funksiyalar yozuv doira ichidami-yo'qmi tekshiradi.
 * Doiradan tashqarida bo'lsa — /forbidden ga yo'naltiradi va kod to'xtaydi.
 *
 * MUHIM: "topilmadi" va "ruxsat yo'q" bir xil javob beradi. Bu ataylab:
 * aks holda hujumchi javoblarni taqqoslab qaysi ID lar mavjudligini
 * aniqlab olishi mumkin (enumeration).
 *
 * @example
 * const user = await requireTeaching();
 * await assertCanAccessStudent(user, params.id);
 * // shundan keyingina yozuvni to'liq o'qish mumkin
 */

/**
 * IDOR URINISHLARINI QAYD ETISH (H4c)
 * ===================================
 *
 * NIMA EDI: doiradan tashqaridagi yozuvga urinish jimgina `/forbidden` ga
 * yo'naltirilardi va HECH QANDAY iz qoldirmasdi. Ya'ni o'qituvchi URL dagi
 * ID ni birma-bir o'zgartirib butun maktab o'quvchilarini titib ko'rsa ham,
 * tizimda bu haqda bitta ham yozuv bo'lmasdi.
 *
 * NEGA XAVFLI: bu H4b da qayd etilgan rol rad etishidan ham qimmatliroq
 * signal. Rol xatosi ko'pincha tasodifiy (eski xatcho'p, noto'g'ri havola).
 * Doira xatosi esa deyarli har doim ATAYLAB: foydalanuvchi o'ziga
 * ko'rsatilmagan ID ni qo'lda kiritgan. Aynan shu — ma'lumot o'g'irlash
 * urinishining birinchi bosqichi.
 *
 * NIMA QILDIM: `assertExists` yo'naltirishdan oldin `PERMISSION_DENIED`
 * (`reason: "scope"`) yozadi. Funksiya ICHKI bo'lgani va barcha
 * chaqiruvchilarida `user` allaqachon mavjud bo'lgani uchun tashqi
 * imzolarga va chaqiruv joylariga tegish kerak bo'lmadi — ya'ni bu qoidani
 * chetlab o'tish imkoni ham yo'q: `assertCanAccess*` ning qaysi biri
 * ishlatilsa ham audit avtomatik ishlaydi.
 *
 * JAVOB O'ZGARMADI: `/forbidden` ga yo'naltirish, "topilmadi" va "ruxsat
 * yo'q" ning bir xil ko'rinishi — hammasi avvalgidek. Audit qaror emas,
 * faqat yozuv.
 */

/**
 * So'ralgan ID ni jurnalga yozishdan oldin tekshiradigan qat'iy shakl.
 *
 * NEGA KERAK: `entityId` — bu foydalanuvchi URL yoki forma orqali bergan
 * XOM qiymat. Uni tekshirmasdan jurnalga yozish ikki xavf tug'diradi:
 *   1. Log injection — hujumchi ID o'rniga yangi qatorli, boshqaruv
 *      belgili yoki JSON-ga o'xshash matn yuborib, jurnalni o'qiydigan
 *      vositani chalg'itishi mumkin.
 *   2. Jadvalni shishirish — ID o'rniga megabaytlik matn yuborilsa, u
 *      bazaga yozilardi.
 *
 * Loyihada ID lar cuid ko'rinishida, ya'ni harf/raqam/`-`/`_`. Shu
 * to'plamdan chiqqan yoki 64 belgidan uzun qiymat ALLOWLIST bo'yicha rad
 * etiladi (blocklist emas — nimani taqiqlashni sanab chiqish emas,
 * nimaga ruxsat berishni sanab chiqish ishonchliroq).
 *
 * Rad etilganda ID yo'qoladi, lekin FAKT saqlanadi: `meta.entityIdFormat`
 * = `"invalid"`. Amalda bu o'z-o'zidan kuchli signal — normal interfeys
 * bunday qiymat yubormaydi.
 */
const SAFE_ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

function safeEntityId(raw: string): string | null {
  return SAFE_ENTITY_ID.test(raw) ? raw : null;
}

/** Rad etishni qayd etish uchun kontekst. Faqat ichki foydalanish. */
type DeniedAccess = {
  user: SessionUser;
  /** Prisma model nomi: "Student", "Class", "Lesson", ... */
  entity: string;
  /** So'ralgan xom ID. Tekshiruvdan o'tmasa jurnalga yozilmaydi. */
  requestedId: string | null;
  /** Faqat kod yasagan qo'shimcha kontekst. */
  meta?: Record<string, unknown>;
};

/**
 * Yozuv topilmasa (= doiradan tashqarida) rad etishni qayd etadi va
 * `/forbidden` ga yo'naltiradi.
 *
 * Generik `T` saqlangan: chaqiruvchida `(await assertExists(...)).id`
 * ko'rinishidagi tip xavfsizligi o'zgarmaydi.
 */
async function assertExists<T>(
  row: T | null,
  denied: DeniedAccess
): Promise<T> {
  if (!row) {
    const safeId =
      denied.requestedId === null ? null : safeEntityId(denied.requestedId);

    // Audit yo'naltirishdan OLDIN: `redirectNever` NEXT_REDIRECT xatosini
    // tashlaydi va undan keyingi kod hech qachon bajarilmaydi.
    // `logPermissionDenied` hech qachon `throw` qilmaydi va o'z ichida
    // dedupe qiladi — ya'ni jurnal xatosi ham, jurnal yuklamasi ham rad
    // etish qaroriga ta'sir qilmaydi.
    await logPermissionDenied({
      userId: denied.user.id,
      reason: "scope",
      entity: denied.entity,
      entityId: safeId,
      meta: {
        role: denied.user.role,
        ...(denied.requestedId !== null && safeId === null
          ? { entityIdFormat: "invalid" }
          : {}),
        ...(denied.meta ?? {}),
      },
    });

    redirectNever("/forbidden");
  }
  return row;
}

/** O'quvchiga kirish huquqini tekshiradi. */
export async function assertCanAccessStudent(
  user: SessionUser,
  studentId: string
): Promise<string> {
  const row = await db.student.findFirst({
    where: { AND: [{ id: studentId }, studentScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, {
      user,
      entity: "Student",
      requestedId: studentId,
    })
  ).id;
}

/** Sinfga kirish huquqini tekshiradi. */
export async function assertCanAccessClass(
  user: SessionUser,
  classId: string
): Promise<string> {
  const row = await db.class.findFirst({
    where: { AND: [{ id: classId }, classScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, { user, entity: "Class", requestedId: classId })
  ).id;
}

/** Darsga kirish huquqini tekshiradi (davomat uchun muhim). */
export async function assertCanAccessLesson(
  user: SessionUser,
  lessonId: string
): Promise<string> {
  const row = await db.lesson.findFirst({
    where: { AND: [{ id: lessonId }, lessonScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, { user, entity: "Lesson", requestedId: lessonId })
  ).id;
}

/**
 * SHU DARSGA BAHO QO'YISH huquqini tekshiradi (6-bosqich).
 *
 * `assertCanAccessLesson` dan farqi: bu yerda sinf rahbarligi yetarli emas,
 * faqat fan o'qituvchisining o'zi (yoki ADMIN) o'tadi.
 *
 * Audit `meta.check = "grade"` bilan yoziladi — shunda jurnalda "darsni
 * ko'rishga urindi" va "begona fandan baho qo'yishga urindi" holatlari
 * farqlanadi. Ikkinchisi ancha jiddiy signal.
 */
export async function assertCanGradeLesson(
  user: SessionUser,
  lessonId: string
): Promise<string> {
  const row = await db.lesson.findFirst({
    where: { AND: [{ id: lessonId }, gradingLessonScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, {
      user,
      entity: "Lesson",
      requestedId: lessonId,
      meta: { check: "grade" },
    })
  ).id;
}

/**
 * SHU SINFNING SHU FANIGA baho qo'yish huquqini tekshiradi (oylik jurnal).
 *
 * Jurnal bir oylik bo'lgani uchun bitta `lessonId` yetarli emas — oyda o'sha
 * fan bir necha marta o'tiladi. Shuning uchun tekshiruv "sinf + fan"
 * juftligi bo'yicha bajariladi: shu juftlikda foydalanuvchining darsi
 * bormi-yo'qmi.
 *
 * Bu ham `gradingLessonScope` ga tayanadi, ya'ni sinf rahbarligi yetarli
 * emas — faqat fan o'qituvchisi (yoki ADMIN).
 *
 * Audit: bitta ID yo'q (juftlik bo'yicha izlanadi), shuning uchun
 * `entityId` bo'sh qoladi va so'ralgan juftlik `meta` ga yoziladi —
 * ikkovi ham xuddi shu `safeEntityId` filtridan o'tadi.
 */
export async function assertCanGradeClassSubject(
  user: SessionUser,
  classId: string,
  subjectId: string
): Promise<string> {
  const row = await db.lesson.findFirst({
    where: {
      AND: [{ classId, subjectId }, gradingLessonScope(user)],
    },
    select: { id: true },
  });
  return (
    await assertExists(row, {
      user,
      entity: "Lesson",
      requestedId: null,
      meta: {
        check: "gradeClassSubject",
        classId: safeEntityId(classId),
        subjectId: safeEntityId(subjectId),
      },
    })
  ).id;
}

/** Bahoga kirish huquqini tekshiradi. */
export async function assertCanAccessGrade(
  user: SessionUser,
  gradeId: string
): Promise<string> {
  const row = await db.grade.findFirst({
    where: { AND: [{ id: gradeId }, gradeScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, { user, entity: "Grade", requestedId: gradeId })
  ).id;
}

/** Davomat yozuviga kirish huquqini tekshiradi. */
export async function assertCanAccessAttendance(
  user: SessionUser,
  attendanceId: string
): Promise<string> {
  const row = await db.attendance.findFirst({
    where: { AND: [{ id: attendanceId }, attendanceScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, {
      user,
      entity: "Attendance",
      requestedId: attendanceId,
    })
  ).id;
}

/** Jarima ballga kirish huquqini tekshiradi. */
export async function assertCanAccessPenalty(
  user: SessionUser,
  penaltyId: string
): Promise<string> {
  const row = await db.penalty.findFirst({
    where: { AND: [{ id: penaltyId }, penaltyScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, {
      user,
      entity: "Penalty",
      requestedId: penaltyId,
    })
  ).id;
}

/** Hisob-fakturaga kirish huquqini tekshiradi. */
export async function assertCanAccessInvoice(
  user: SessionUser,
  invoiceId: string
): Promise<string> {
  const row = await db.invoice.findFirst({
    where: { AND: [{ id: invoiceId }, invoiceScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, {
      user,
      entity: "Invoice",
      requestedId: invoiceId,
    })
  ).id;
}

/** To'lovga kirish huquqini tekshiradi. */
export async function assertCanAccessPayment(
  user: SessionUser,
  paymentId: string
): Promise<string> {
  const row = await db.payment.findFirst({
    where: { AND: [{ id: paymentId }, paymentScope(user)] },
    select: { id: true },
  });
  return (
    await assertExists(row, {
      user,
      entity: "Payment",
      requestedId: paymentId,
    })
  ).id;
}
