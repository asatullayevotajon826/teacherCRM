"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createAction, formDataToObject } from "@/lib/safe-action";
import { redirectNever } from "@/lib/auth-guard";
import { logError } from "@/lib/logger";
import { lessonScope } from "@/lib/scope";
import { toDate, type SaveResult } from "@/lib/academics";
import { dayOfWeekFromText } from "@/lib/attendance";
import { attendanceGridSaveSchema } from "@/lib/attendance-grid";
import { queueAbsenceNotices } from "@/lib/absence-notice";

/**
 * DAVOMATNI SAQLASH — SINF BO'YICHA KUNLIK JADVAL
 * ===============================================
 *
 * Xavfsizlik zanjiri:
 *   1. `roles` — faqat ADMIN va TEACHER yozadi (PARENT ko'radi,
 *      ACCOUNTANT umuman kirmaydi)
 *   2. zod — kirish shakli va qisqartmalar tekshiriladi
 *   3. `lessonScope` — server O'ZI foydalanuvchining shu kundagi darslarini
 *      topadi. Klientdan kelgan dars ID lari shu ro'yxat bilan solishtiriladi,
 *      begonalari JIMGINA tashlanadi (IDOR himoyasi)
 *   4. o'quvchi filtri — faqat SHU sinfdagi o'quvchilar yozuvi saqlanadi
 *   5. audit — kim, qachon, qaysi sinfga davomat qo'ydi
 *
 * 3-qadam eng muhimi: forma maydonlari "ag:<studentId>:<lessonId>"
 * ko'rinishida, ya'ni so'rovni qo'lda yasagan odam boshqa o'qituvchining
 * darsi yoki boshqa sinf o'quvchisini qo'shib yuborishi mumkin. Shuning
 * uchun klientdagi `disabled` ga hech qachon ishonilmaydi.
 *
 * NIMA UCHUN `lessonScope` (`gradingLessonScope` emas): davomatni SINF
 * RAHBARI ham qo'yishi kerak — o'qituvchi kelmaganda yoki xatoni
 * to'g'rilaganda. Baho esa faqat fan o'qituvchisiga tegishli. Bu
 * assimetriya ataylab qilingan.
 *
 * TASHLANGAN KATAKCHALAR QAYD ETILADI (PR G3c): begona katakchani jimgina
 * tashlash — to'g'ri qaror (xato xabari hujumchiga qaysi dars yoki qaysi
 * o'quvchi mavjudligini bildirmasligi kerak). Lekin ilgari bu urinish
 * SERVERDA HAM iz qoldirmasdi, ya'ni IDOR sinovi normal ishlashdan
 * farq qilmasdi. Endi tashlangan katakchalarning SONI qayd etiladi —
 * id'lar yozilmaydi, foydalanuvchi ko'radigan javob esa o'zgarmadi.
 */

export type AttendanceFormState = { error?: string };

const saveAttendanceGridAction = createAction({
  roles: ["ADMIN", "TEACHER"],
  schema: attendanceGridSaveSchema,
  handler: async (input, user): Promise<SaveResult> => {
    const dayOfWeek = dayOfWeekFromText(input.date);

    // Serverning o'zi topadigan ruxsat etilgan darslar ro'yxati.
    const myLessons = await db.lesson.findMany({
      where: {
        AND: [lessonScope(user), { classId: input.classId, dayOfWeek }],
      },
      select: { id: true },
    });

    if (myLessons.length === 0) {
      return {
        ok: false,
        message: "Bu kunda bu sinfda sizga tegishli dars yo'q.",
      };
    }

    const allowedLessons = new Set(myLessons.map((lesson) => lesson.id));

    const classStudents = await db.student.findMany({
      where: { classId: input.classId },
      select: { id: true },
    });
    const allowedStudents = new Set(
      classStudents.map((student) => student.id)
    );

    const entries = input.entries.filter(
      (entry) =>
        allowedLessons.has(entry.lessonId) &&
        allowedStudents.has(entry.studentId)
    );

    /**
     * Doiradan tashqari katakchalar soni.
     *
     * MAXFIYLIK: faqat SON yoziladi. `studentId`/`lessonId` log'ga
     * tushirilsa, log'ning o'zi "qaysi id mavjud" degan savolga javob
     * beradigan manbaga aylanardi.
     */
    const droppedEntries = input.entries.length - entries.length;
    if (droppedEntries > 0) {
      logError(
        "attendance:grid",
        new Error("doiradan tashqari katakchalar tashlab yuborildi"),
        {
          stage: "scope",
          userId: user.id,
          classId: input.classId,
          sent: input.entries.length,
          dropped: droppedEntries,
        }
      );
    }

    if (entries.length === 0) {
      return {
        ok: false,
        message: "Kamida bitta katakchaga holat kiriting.",
      };
    }

    const date = toDate(input.date);

    // Bitta tranzaksiya: yoki hammasi saqlanadi, yoki hech narsa.
    await db.$transaction(
      entries.map((entry) =>
        db.attendance.upsert({
          where: {
            studentId_lessonId_date: {
              studentId: entry.studentId,
              lessonId: entry.lessonId,
              date,
            },
          },
          create: {
            studentId: entry.studentId,
            lessonId: entry.lessonId,
            date,
            status: entry.status,
          },
          update: { status: entry.status },
        })
      )
    );

    /**
     * Ota-onaga xabar — tranzaksiyadan TASHQARIDA.
     * Sabab: SMS navbati sekin ishlaydi va u tufayli davomat yozuvi
     * qaytib ketishi mumkin emas.
     *
     * Bir kunda bir o'quvchi bir necha darsdan qolsa ham bitta xabar
     * yuboriladi — shuning uchun ID lar takrorlanmaydigan ro'yxatga
     * aylantiriladi.
     */
    const absentIds = Array.from(
      new Set(
        entries
          .filter((entry) => entry.status === "ABSENT")
          .map((entry) => entry.studentId)
      )
    );
    await queueAbsenceNotices(absentIds, input.date);

    // Locale prefiksisiz — konvensiya bo'yicha.
    revalidatePath("/attendance");
    revalidatePath("/attendance/journal");
    revalidatePath("/journal");
    revalidatePath("/dashboard");

    return { ok: true, id: input.classId };
  },
  audit: {
    action: "UPDATE",
    entity: "Attendance",
    entityId: (input) => input.classId,
    meta: (input) => ({
      source: "grid",
      date: input.date,
      marked: input.entries.length,
    }),
  },
});

function attendanceUrl(
  classId: string,
  date: string,
  saved?: boolean
): string {
  const params = new URLSearchParams({ date });
  if (classId) params.set("classId", classId);
  if (saved) params.set("saved", "1");
  return `/attendance?${params.toString()}`;
}

export async function saveAttendanceGrid(
  _prev: AttendanceFormState,
  formData: FormData
): Promise<AttendanceFormState> {
  const raw = formDataToObject(formData);
  const result = await saveAttendanceGridAction(raw);

  if (!result.ok) return { error: result.error };
  if (!result.data.ok) return { error: result.data.message };

  redirectNever(
    attendanceUrl(String(raw.classId ?? ""), String(raw.date ?? ""), true)
  );
}
