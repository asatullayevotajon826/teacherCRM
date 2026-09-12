"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createAction, formDataToObject } from "@/lib/safe-action";
import { logAudit } from "@/lib/audit";
import { logError } from "@/lib/logger";
import { redirectNever } from "@/lib/auth-guard";
import { gradingLessonScope } from "@/lib/scope";
import { toDate, type SaveResult } from "@/lib/academics";
import { dayOfWeekFromText, type AttendanceStatusValue } from "@/lib/attendance";
import { journalSaveSchema } from "@/lib/journal";
import { type GradeTypeValue } from "@/lib/grades";
import { queueAbsenceNotices } from "@/lib/absence-notice";

/**
 * KUNLIK JURNALNI SAQLASH
 * =======================
 *
 * Xavfsizlik zanjiri:
 *   1. `roles` — faqat ADMIN va TEACHER yozadi (PARENT/ACCOUNTANT umuman yo'q)
 *   2. zod — kirish shakli, 0–100 oralig'i, baho turi, qisqartmalar
 *   3. `gradingLessonScope` — O'Z darslari SERVERDA topiladi; klient qaysi
 *      ustun ochiq ekanini AYTMAYDI
 *   4. o'quvchi filtri — faqat SHU sinf o'quvchilari
 *   5. o'quv yili + chorak tekshiruvi — `Grade.quarterId` majburiy
 *   6. audit — kim, qachon, qaysi bahoni nimadan nimaga o'zgartirdi
 *
 * 3-QADAM ENG MUHIMI. Jadvaldagi bloklangan input — bu faqat ko'rinish:
 * brauzer konsolidan `disabled` ni olib tashlab, boshqa fan ustuniga qiymat
 * yuborish mumkin. Shuning uchun server klientdan kelgan ustun ro'yxatiga
 * umuman ishonmaydi — o'zi `gradingLessonScope` bilan qidiradi va begona
 * darsga kelgan katakchani JIMGINA tashlab yuboradi (xato xabari hujumchiga
 * qaysi dars mavjudligini bildirmasligi kerak).
 *
 * TASHLANGAN KATAKCHALAR QAYD ETILADI (PR G3c): jimgina tashlash — to'g'ri
 * qaror, lekin ilgari bu urinish SERVERDA HAM iz qoldirmasdi. Ya'ni kimdir
 * boshqa sinfning bahosini o'zgartirishga urinsa, tizim to'g'ri to'sardi,
 * ammo bu urinish normal ishlashdan farq qilmasdi. Endi tashlangan
 * katakchalarning SONI log'ga va audit jurnaliga tushadi — id'lar
 * yozilmaydi, foydalanuvchi ko'radigan javob esa o'zgarmadi.
 *
 * 5-QADAM — TUZATILGAN NUQSON. Ilgari chorak `where: academicYearId ? {...} : {}`
 * bilan qidirilardi. `Class.academicYearId` ixtiyoriy maydon (`onDelete: SetNull`),
 * ya'ni bo'sh bo'lishi mumkin — bunday holatda BARCHA o'quv yillarining
 * choraklari yuklanib, baho butunlay boshqa yilning choragiga jimgina tushib
 * ketardi. Endi o'quv yili bo'lmasa saqlash to'xtaydi va foydalanuvchiga
 * aniq xabar chiqadi.
 *
 * TRANZAKSIYA CHEGARASI — TUZATILGAN NUQSON. Prisma'da `$transaction` sukut
 * bo'yicha 5 sekundda uziladi (`maxWait` 2s). To'la sinf jurnali ~240 baho +
 * ~60 davomat yozuvi degani; ular bitta-bitta `await` bilan yozilsa chegaraga
 * urilib "Transaction already closed" xatosi chiqardi. Endi:
 *   - o'chirish  -> bitta `deleteMany`
 *   - yaratish   -> bitta `createMany`
 *   - davomat    -> holat bo'yicha guruhlangan `updateMany` (ko'pi bilan 4 ta)
 *                   + bitta `createMany`
 *   - yangilash  -> faqat HAQIQATDA o'zgargan katakchalar (odatda bir nechta)
 * va yuqori chegara ham ko'tarildi. Natijada bazaga borish soni ~300 dan
 * ~10 ga tushdi.
 *
 * AVTOMATIK "KELDI": baho qo'yilgan o'quvchi darsda bo'lgan — shuning uchun
 * davomat belgilanmagan bo'lsa PRESENT qo'yiladi. Bu o'qituvchining ishini
 * qisqartiradi, lekin qo'lda qo'yilgan belgini BOSMAYDI (masalan kechikkan
 * o'quvchi baho olsa, KCH saqlanib qoladi).
 */

export type JournalFormState = { error?: string };

/** Auditga yoziladigan bitta baho o'zgarishi. */
type GradeChange = {
  studentId: string;
  lessonId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  from: number | null;
  to: number | null;
};

/** Audit `meta` cheksiz o'smasligi uchun chegara. */
const AUDIT_CHANGE_LIMIT = 300;

const saveJournalAction = createAction({
  roles: ["ADMIN", "TEACHER"],
  schema: journalSaveSchema,
  handler: async (input, user): Promise<SaveResult> => {
    const dayOfWeek = dayOfWeekFromText(input.date);
    const gradeType: GradeTypeValue = input.type;

    // 3-qadam: O'Z darslari. ADMIN uchun doira bo'sh — hammasi ochiq.
    const myLessons = await db.lesson.findMany({
      where: {
        AND: [{ classId: input.classId, dayOfWeek }, gradingLessonScope(user)],
      },
      select: {
        id: true,
        subjectId: true,
        teacherId: true,
        class: { select: { academicYearId: true } },
      },
    });

    if (myLessons.length === 0) {
      return { ok: false, message: "Bu kunda bu sinfda darsingiz yo'q." };
    }

    const lessonById = new Map(myLessons.map((lesson) => [lesson.id, lesson]));

    // 5-qadam (birinchi yarmi): o'quv yili MAJBURIY — pastdagi izohga qarang.
    const academicYearId = myLessons[0].class.academicYearId;
    if (!academicYearId) {
      return {
        ok: false,
        message:
          "Bu sinfga o'quv yili biriktirilmagan. Avval sinf sozlamasida o'quv yilini tanlang.",
      };
    }

    // 4-qadam: faqat shu sinf o'quvchilari.
    const classStudents = await db.student.findMany({
      where: { classId: input.classId },
      select: { id: true },
    });
    const allowedStudents = new Set(
      classStudents.map((student) => student.id)
    );

    const gradeEntries = input.grades.filter(
      (entry) =>
        allowedStudents.has(entry.studentId) && lessonById.has(entry.lessonId)
    );
    const attendanceEntries = input.attendance.filter((entry) =>
      allowedStudents.has(entry.studentId)
    );

    /**
     * Doiradan tashqari katakchalar soni (IDOR sinovining izi).
     *
     * MAXFIYLIK: faqat SON yoziladi. `studentId`/`lessonId` log'ga
     * tushirilsa, log'ning o'zi "qaysi id mavjud" degan savolga javob
     * beradigan manbaga aylanardi.
     *
     * Normal ishlashda bu son har doim 0 bo'ladi — chunki interfeys
     * faqat ochiq katakchalarni yuboradi. Noldan farqli qiymat
     * so'rov QO'LDA yasalganini ko'rsatadi.
     */
    const droppedGrades = input.grades.length - gradeEntries.length;
    const droppedAttendance =
      input.attendance.length - attendanceEntries.length;

    if (droppedGrades > 0 || droppedAttendance > 0) {
      logError(
        "journal:save",
        new Error("doiradan tashqari katakchalar tashlab yuborildi"),
        {
          stage: "scope",
          userId: user.id,
          classId: input.classId,
          sentGrades: input.grades.length,
          droppedGrades,
          sentAttendance: input.attendance.length,
          droppedAttendance,
        }
      );
    }

    if (gradeEntries.length === 0 && attendanceEntries.length === 0) {
      return { ok: false, message: "Saqlash uchun ma'lumot kiritilmadi." };
    }

    const date = toDate(input.date);

    // 5-qadam (ikkinchi yarmi): chorak. Baho qo'yilmasa (faqat davomat)
    // chorak umuman kerak emas — shuning uchun so'rov ham qilinmaydi.
    const needsQuarter = gradeEntries.some((entry) => entry.value !== null);
    let quarterId: string | null = null;

    if (needsQuarter) {
      const quarters = await db.quarter.findMany({
        where: { academicYearId },
        select: { id: true, startDate: true, endDate: true },
      });
      const quarter = quarters.find(
        (row) => row.startDate <= date && date <= row.endDate
      );

      if (!quarter) {
        return {
          ok: false,
          message: `Bu sanaga mos chorak topilmadi: ${input.date}. O'quv yili va chorak sanalarini tekshiring.`,
        };
      }
      quarterId = quarter.id;
    }

    /**
     * Mavjud baholarni SERVER o'zi topadi — klientdan baho ID si olinmaydi.
     * Aks holda hujumchi begona ID yuborib boshqa o'quvchining bahosini
     * o'zgartirishi mumkin bo'lardi.
     *
     * Tur bo'yicha ham filtrlanadi: kundalik baho nazorat bahosining ustiga
     * yozilmasligi kerak — ular jurnalda alohida varaq.
     */
    const existing = await db.grade.findMany({
      where: {
        studentId: { in: gradeEntries.map((entry) => entry.studentId) },
        date,
        type: gradeType,
      },
      select: {
        id: true,
        studentId: true,
        subjectId: true,
        lessonId: true,
        value: true,
      },
    });

    const byLesson = new Map<string, (typeof existing)[number]>();
    /**
     * `Grade.lessonId` maydoni keyin qo'shilgani uchun eski baholarda u bo'sh.
     * Shunday yozuv topilsa, uni yangi ustunga "asrab olamiz" (lessonId
     * to'ldiriladi) — shunda eski baholar jurnalda dublikat bo'lib
     * ko'rinmaydi.
     */
    const legacyBySubject = new Map<string, (typeof existing)[number]>();

    for (const row of existing) {
      if (row.lessonId) {
        byLesson.set(`${row.studentId}|${row.lessonId}`, row);
      } else {
        legacyBySubject.set(`${row.studentId}|${row.subjectId}`, row);
      }
    }

    // Davomat: qo'lda belgilangan holatlar + avtomatik "keldi".
    const statusByStudent = new Map<string, AttendanceStatusValue>();
    for (const entry of attendanceEntries) {
      statusByStudent.set(entry.studentId, entry.status);
    }
    for (const entry of gradeEntries) {
      if (entry.value === null) continue;
      if (!statusByStudent.has(entry.studentId)) {
        statusByStudent.set(entry.studentId, "PRESENT");
      }
    }

    // ----------------------------------------------------------------
    // REJA TUZISH (bazaga tegmasdan)
    //
    // Avval nima o'zgarishini to'liq hisoblab olamiz, keyin tranzaksiya
    // ichida to'plam bo'lib yozamiz. Shu tufayli tranzaksiya qisqa bo'ladi
    // va auditga aniq ro'yxat yozish mumkin.
    // ----------------------------------------------------------------

    const gradeIdsToDelete: string[] = [];
    const gradeUpdates: Array<{
      id: string;
      value: number;
      lessonId: string;
      teacherId: string;
    }> = [];
    const gradeCreates: Array<{
      studentId: string;
      subjectId: string;
      lessonId: string;
      quarterId: string;
      value: number;
      type: GradeTypeValue;
      date: Date;
      teacherId: string;
    }> = [];
    const gradeChanges: GradeChange[] = [];

    for (const entry of gradeEntries) {
      const lesson = lessonById.get(entry.lessonId);
      if (!lesson) continue;

      const lessonKey = `${entry.studentId}|${entry.lessonId}`;
      const legacyKey = `${entry.studentId}|${lesson.subjectId}`;

      let current = byLesson.get(lessonKey);
      if (!current) {
        current = legacyBySubject.get(legacyKey);
        // Bir eski yozuv faqat BITTA ustunga asrab olinadi — aks holda bir
        // fandan ikki dars bo'lganda ikkinchi ustun birinchisining ustiga
        // yozib, bahoni yo'q qilib qo'yardi.
        if (current) legacyBySubject.delete(legacyKey);
      }

      // Bo'sh katakcha = bahoni olib tashlash.
      if (entry.value === null) {
        if (current) {
          gradeIdsToDelete.push(current.id);
          gradeChanges.push({
            studentId: entry.studentId,
            lessonId: entry.lessonId,
            action: "DELETE",
            from: current.value,
            to: null,
          });
        }
        continue;
      }

      if (current) {
        // O'zgarmagan katakcha — bazaga tegmaymiz.
        if (
          current.value === entry.value &&
          current.lessonId === entry.lessonId
        ) {
          continue;
        }

        gradeUpdates.push({
          id: current.id,
          value: entry.value,
          lessonId: entry.lessonId,
          teacherId: lesson.teacherId,
        });
        gradeChanges.push({
          studentId: entry.studentId,
          lessonId: entry.lessonId,
          action: "UPDATE",
          from: current.value,
          to: entry.value,
        });
        continue;
      }

      gradeCreates.push({
        studentId: entry.studentId,
        subjectId: lesson.subjectId,
        lessonId: entry.lessonId,
        // Yuqorida tekshirildi — baho bo'lsa chorak albatta bor.
        quarterId: quarterId as string,
        value: entry.value,
        type: gradeType,
        date,
        teacherId: lesson.teacherId,
      });
      gradeChanges.push({
        studentId: entry.studentId,
        lessonId: entry.lessonId,
        action: "CREATE",
        from: null,
        to: entry.value,
      });
    }

    /**
     * Davomat foydalanuvchining SHU KUNDAGI BARCHA darslariga yoziladi.
     * Jurnalda bitta "Davomat" ustuni bor, ya'ni belgi kunga tegishli:
     * "bugun keldi". Agar o'qituvchi shu sinfda kunda ikki dars o'tsa,
     * ikkisiga ham bir xil belgi tushadi.
     *
     * `upsert` ni tsikl ichida chaqirish o'rniga mavjud yozuvlarni oldin
     * o'qib olamiz: shunda tranzaksiya ichida faqat guruhlangan `updateMany`
     * va bitta `createMany` qoladi.
     */
    const studentIdsForAttendance = Array.from(statusByStudent.keys());
    const existingAttendance =
      studentIdsForAttendance.length > 0
        ? await db.attendance.findMany({
            where: {
              studentId: { in: studentIdsForAttendance },
              lessonId: { in: myLessons.map((lesson) => lesson.id) },
              date,
            },
            select: {
              id: true,
              studentId: true,
              lessonId: true,
              status: true,
            },
          })
        : [];

    const attendanceByKey = new Map(
      existingAttendance.map((row) => [`${row.studentId}|${row.lessonId}`, row])
    );

    const attendanceIdsByStatus = new Map<AttendanceStatusValue, string[]>();
    const attendanceCreates: Array<{
      studentId: string;
      lessonId: string;
      date: Date;
      status: AttendanceStatusValue;
    }> = [];

    for (const [studentId, status] of statusByStudent) {
      for (const lesson of myLessons) {
        const current = attendanceByKey.get(`${studentId}|${lesson.id}`);

        if (!current) {
          attendanceCreates.push({
            studentId,
            lessonId: lesson.id,
            date,
            status,
          });
          continue;
        }

        // Belgi o'zgarmagan — bazaga tegmaymiz.
        if (current.status === status) continue;

        const ids = attendanceIdsByStatus.get(status) ?? [];
        ids.push(current.id);
        attendanceIdsByStatus.set(status, ids);
      }
    }

    const attendanceChanged =
      attendanceCreates.length +
      Array.from(attendanceIdsByStatus.values()).reduce(
        (sum, ids) => sum + ids.length,
        0
      );

    const changed = gradeChanges.length + attendanceChanged;

    // Bo'sh tranzaksiya ochish keraksiz — darhol qaytamiz.
    if (changed === 0) {
      return { ok: false, message: "O'zgarish yo'q." };
    }

    // Bitta tranzaksiya: yoki hammasi saqlanadi, yoki hech narsa.
    await db.$transaction(
      async (tx) => {
        if (gradeIdsToDelete.length > 0) {
          await tx.grade.deleteMany({
            where: { id: { in: gradeIdsToDelete } },
          });
        }

        for (const row of gradeUpdates) {
          await tx.grade.update({
            where: { id: row.id },
            data: {
              value: row.value,
              lessonId: row.lessonId,
              teacherId: row.teacherId,
            },
          });
        }

        if (gradeCreates.length > 0) {
          // `skipDuplicates` — ikki marta yuborilgan forma dublikat
          // yaratmasligi uchun (baza darajasidagi idempotentlik).
          await tx.grade.createMany({
            data: gradeCreates,
            skipDuplicates: true,
          });
        }

        for (const [status, ids] of attendanceIdsByStatus) {
          await tx.attendance.updateMany({
            where: { id: { in: ids } },
            data: { status },
          });
        }

        if (attendanceCreates.length > 0) {
          await tx.attendance.createMany({
            data: attendanceCreates,
            skipDuplicates: true,
          });
        }
      },
      // To'la sinf jurnali uchun sukutdagi 5s/2s kam — pastdagi izohga qarang.
      { timeout: 20_000, maxWait: 10_000 }
    );

    /**
     * 6-qadam: AUDIT.
     *
     * Xavfsizlik auditining 24-punkti: baho o'zgarishi majburiy ravishda
     * jurnalga tushishi kerak. Ilgari faqat "nechta katakcha yuborilgani"
     * yozilardi — ya'ni o'chirilgan baho butunlay iz qoldirmasdi va
     * "mening bahom yo'qolgan" degan da'voni tekshirish imkonsiz edi.
     * Endi har bir o'zgarish nomma-nom yoziladi.
     *
     * `createAction` ning `audit` bloki ishlatilmadi, chunki u faqat KIRISH
     * ma'lumotini ko'radi — natijani (eski -> yangi qiymat) bilmaydi.
     */
    await logAudit({
      userId: user.id,
      action: "UPDATE",
      entity: "Grade",
      entityId: input.classId,
      meta: {
        source: "journal",
        date: input.date,
        gradeType,
        lessonIds: myLessons.map((lesson) => lesson.id),
        created: gradeCreates.length,
        updated: gradeUpdates.length,
        deleted: gradeIdsToDelete.length,
        attendanceChanged,
        // Doiradan tashqari katakchalar — faqat son (PR G3c).
        droppedGrades,
        droppedAttendance,
        changes: gradeChanges.slice(0, AUDIT_CHANGE_LIMIT),
        truncated: gradeChanges.length > AUDIT_CHANGE_LIMIT,
      },
    });

    // Tranzaksiyadan TASHQARIDA: SMS navbati asosiy saqlashni ushlab
    // turmasligi kerak.
    await queueAbsenceNotices(
      Array.from(statusByStudent)
        .filter(([, status]) => status === "ABSENT")
        .map(([studentId]) => studentId),
      input.date
    );

    // Locale prefiksisiz — konvensiya bo'yicha.
    revalidatePath("/journal");
    revalidatePath("/grades");
    revalidatePath("/attendance");
    revalidatePath("/attendance/journal");
    revalidatePath("/ranking");

    return { ok: true, id: input.classId };
  },
});

function journalUrl(
  raw: Record<string, unknown>,
  saved?: boolean
): string {
  const params = new URLSearchParams({
    classId: String(raw.classId ?? ""),
    date: String(raw.date ?? ""),
  });

  // Baho turi saqlanib qolishi kerak — aks holda nazorat bahosini kiritgan
  // o'qituvchi saqlagandan keyin kundalik varaqqa qaytib tushardi.
  const type = String(raw.type ?? "").trim();
  if (type !== "") params.set("type", type);

  if (saved) params.set("saved", "1");
  return `/journal?${params.toString()}`;
}

export async function saveJournal(
  _prev: JournalFormState,
  formData: FormData
): Promise<JournalFormState> {
  const raw = formDataToObject(formData);
  const result = await saveJournalAction(raw);

  if (!result.ok) return { error: result.error };
  if (!result.data.ok) return { error: result.data.message };

  redirectNever(journalUrl(raw, true));
}
