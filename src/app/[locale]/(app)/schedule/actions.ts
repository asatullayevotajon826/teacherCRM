"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createAction, formDataToObject } from "@/lib/safe-action";
import { redirectNever } from "@/lib/auth-guard";
import type { SaveResult } from "@/lib/academics";
import {
  lessonDeleteSchema,
  lessonUpdateSchema,
  lessonWriteSchema,
} from "@/lib/lessons";

export type LessonFormState = { error?: string };

type ConflictInput = {
  id?: string;
  classId: string;
  teacherId: string;
  periodId: string;
  dayOfWeek: number;
  room?: string;
};

type TxLike = {
  lesson: {
    findMany: (args: unknown) => Promise<
      Array<{ id: string; classId: string; teacherId: string; room: string | null }>
    >;
  };
  lessonPeriod: {
    findUnique: (args: unknown) => Promise<
      { id: string; startTime: string; endTime: string } | null
    >;
  };
};

/**
 * Bir uyada (kun + qo'ng'iroq vaqti) uchta narsa takrorlanmasligi kerak:
 * o'qituvchi, sinf va xona. Tekshiruv transaction ichida bajariladi — ikki
 * admin bir vaqtda saqlasa ham jadval buzilmaydi.
 */
async function findConflict(
  tx: TxLike,
  input: ConflictInput
): Promise<string | null> {
  const sameSlot = await tx.lesson.findMany({
    where: {
      dayOfWeek: input.dayOfWeek,
      periodId: input.periodId,
      ...(input.id ? { id: { not: input.id } } : {}),
    },
    select: { id: true, classId: true, teacherId: true, room: true },
  });

  if (sameSlot.some((lesson) => lesson.teacherId === input.teacherId)) {
    return "Bu vaqtda o'qituvchining boshqa darsi bor.";
  }
  if (sameSlot.some((lesson) => lesson.classId === input.classId)) {
    return "Bu vaqtda sinfning boshqa darsi bor.";
  }
  if (
    input.room &&
    sameSlot.some(
      (lesson) =>
        lesson.room &&
        lesson.room.toLowerCase() === input.room?.toLowerCase()
    )
  ) {
    return "Bu vaqtda xona band.";
  }
  return null;
}

function revalidateSchedule(classId: string) {
  revalidatePath("/schedule");
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
}

const createLessonAction = createAction({
  roles: ["ADMIN"],
  schema: lessonWriteSchema,
  handler: async (input): Promise<SaveResult> => {
    const result = await db.$transaction(async (tx) => {
      const period = await tx.lessonPeriod.findUnique({
        where: { id: input.periodId },
        select: { id: true, startTime: true, endTime: true },
      });
      if (!period) {
        return {
          ok: false as const,
          message: "Dars vaqti (qo'ng'iroq jadvali) topilmadi.",
        };
      }

      const conflict = await findConflict(tx as unknown as TxLike, input);
      if (conflict) return { ok: false as const, message: conflict };

      const lesson = await tx.lesson.create({
        data: {
          classId: input.classId,
          subjectId: input.subjectId,
          teacherId: input.teacherId,
          periodId: period.id,
          dayOfWeek: input.dayOfWeek,
          startTime: period.startTime,
          endTime: period.endTime,
          room: input.room ?? null,
        },
        select: { id: true },
      });
      return { ok: true as const, id: lesson.id };
    });

    if (result.ok) revalidateSchedule(input.classId);
    return result;
  },
  audit: {
    action: "CREATE",
    entity: "Lesson",
    entityId: (_input, result) => (result.ok ? result.id : null),
    meta: (input) => ({
      classId: input.classId,
      dayOfWeek: input.dayOfWeek,
      periodId: input.periodId,
    }),
  },
});

const updateLessonAction = createAction({
  roles: ["ADMIN"],
  schema: lessonUpdateSchema,
  handler: async (input): Promise<SaveResult> => {
    const result = await db.$transaction(async (tx) => {
      const period = await tx.lessonPeriod.findUnique({
        where: { id: input.periodId },
        select: { id: true, startTime: true, endTime: true },
      });
      if (!period) {
        return {
          ok: false as const,
          message: "Dars vaqti (qo'ng'iroq jadvali) topilmadi.",
        };
      }

      const conflict = await findConflict(tx as unknown as TxLike, input);
      if (conflict) return { ok: false as const, message: conflict };

      await tx.lesson.update({
        where: { id: input.id },
        data: {
          classId: input.classId,
          subjectId: input.subjectId,
          teacherId: input.teacherId,
          periodId: period.id,
          dayOfWeek: input.dayOfWeek,
          startTime: period.startTime,
          endTime: period.endTime,
          room: input.room ?? null,
        },
      });
      return { ok: true as const, id: input.id };
    });

    if (result.ok) revalidateSchedule(input.classId);
    return result;
  },
  audit: {
    action: "UPDATE",
    entity: "Lesson",
    entityId: (input) => input.id,
  },
});

const deleteLessonAction = createAction({
  roles: ["ADMIN"],
  schema: lessonDeleteSchema,
  handler: async (input): Promise<{ deleted: boolean; classId?: string }> => {
    const lesson = await db.lesson.findUnique({
      where: { id: input.id },
      select: { id: true, classId: true },
    });
    if (!lesson) return { deleted: false };

    // Darsni o'chirish davomat yozuvlarini ham olib ketadi (Cascade),
    // shuning uchun darsda davomat bo'lsa o'chirishni to'xtatamiz.
    const attendanceCount = await db.attendance.count({
      where: { lessonId: input.id },
    });
    if (attendanceCount > 0) return { deleted: false, classId: lesson.classId };

    /**
     * BAHOSI BOR DARS O'CHIRILMAYDI (F3).
     *
     * Ilgari `Grade.lessonId` dars o'chirilganda NULL ga tushardi
     * (`onDelete: SetNull`). Natijada baho "darssiz" qolib,
     * `@@unique([studentId, lessonId, date, type])` cheklovidan chiqib
     * ketardi — PostgreSQL da NULL o'zi bilan teng emas. Ya'ni jadvalni
     * tahrirlash orqali takroriy baho yozish yo'li ochilardi va o'rtacha
     * ball bilan reyting buzilardi.
     *
     * Endi baza darajasida `onDelete: Restrict` turibdi. Bu tekshiruv esa
     * foydalanuvchi xunuk baza xatosini ko'rmasligi uchun: o'chirish shu
     * yerda to'xtaydi va jadvalda tushunarli ogohlantirish chiqadi
     * (davomat bilan bir xil yo'l).
     *
     * Baholarni avval jurnaldan olib tashlash kerak — bu ataylab qo'lda
     * qilinadi: baho o'chirish auditga tushishi shart.
     */
    const gradeCount = await db.grade.count({
      where: { lessonId: input.id },
    });
    if (gradeCount > 0) return { deleted: false, classId: lesson.classId };

    await db.lesson.delete({ where: { id: input.id } });
    revalidateSchedule(lesson.classId);
    return { deleted: true, classId: lesson.classId };
  },
  audit: {
    action: "DELETE",
    entity: "Lesson",
    entityId: (input) => input.id,
    meta: (_input, result) => ({ deleted: result.deleted }),
  },
});

function scheduleUrl(classId: string, error?: string): string {
  const base = `/schedule?classId=${classId}`;
  return error ? `${base}&error=${error}` : base;
}

export async function createLesson(
  _prev: LessonFormState,
  formData: FormData
): Promise<LessonFormState> {
  const raw = formDataToObject(formData);
  const result = await createLessonAction(raw);
  if (!result.ok) return { error: result.error };
  if (!result.data.ok) return { error: result.data.message };
  redirectNever(scheduleUrl(String(raw.classId ?? "")));
}

export async function updateLesson(
  _prev: LessonFormState,
  formData: FormData
): Promise<LessonFormState> {
  const raw = formDataToObject(formData);
  const result = await updateLessonAction(raw);
  if (!result.ok) return { error: result.error };
  if (!result.data.ok) return { error: result.data.message };
  redirectNever(scheduleUrl(String(raw.classId ?? "")));
}

export async function deleteLesson(formData: FormData): Promise<void> {
  const raw = formDataToObject(formData);
  const result = await deleteLessonAction(raw);
  if (!result.ok || !result.data.deleted) {
    const classId = result.ok ? result.data.classId ?? "" : "";
    redirectNever(scheduleUrl(classId, "deleteBlocked"));
  }
  redirectNever(scheduleUrl(result.data.classId ?? ""));
}
