import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { redirectNever, requireRole } from "@/lib/auth-guard";
import { assertCanAccessClass, classScope } from "@/lib/scope";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  assignStudents,
  deleteClass,
  moveStudents,
  removeStudent,
} from "../actions";

const DAYS = [1, 2, 3, 4, 5, 6];

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const user = await requireRole("ADMIN", "TEACHER");
  // 1-QAVAT IDOR himoyasi: sinf doira ichida bo'lmasa — /forbidden.
  await assertCanAccessClass(user, params.id);

  const t = await getTranslations("classes");
  const tSchedule = await getTranslations("schedule");
  const canWrite = user.role === "ADMIN";

  /**
   * 2-QAVAT IDOR HIMOYASI.
   *
   * Yuqoridagi qorovul yetarli ko'rinadi, lekin u ALOHIDA funksiya — kimdir
   * uni tahrirlaganda yoki yangi shart qo'shganda xato qilsa, bu sahifa
   * jimgina begona sinfni ko'rsatib qo'yardi. Shuning uchun so'rovning o'zi
   * ham doiralangan: `findUnique({ where: { id } })` emas, `classScope(user)`
   * bilan `findFirst`. Endi begona sinf ID si bilan kelingan so'rov bazadan
   * hech narsa qaytarmaydi — qorovul ishlamay qolgan holatda ham.
   *
   * Shu naqsh `students/[id]` sahifasida ham qo'llangan: qorovul + doira.
   */
  const klass = await db.class.findFirst({
    where: { AND: [classScope(user), { id: params.id }] },
    include: {
      academicYear: { select: { name: true } },
      homeroomTeacher: { select: { user: { select: { fullName: true } } } },
      students: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true, status: true },
      },
      lessons: {
        include: {
          subject: { select: { nameUz: true } },
          teacher: { select: { user: { select: { fullName: true } } } },
          period: { select: { index: true, startTime: true, endTime: true } },
        },
      },
    },
  });
  if (!klass) {
    redirectNever("/forbidden");
  }

  const unassigned = canWrite
    ? await db.student.findMany({
        where: { classId: null, status: "ACTIVE" },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true },
        take: 300,
      })
    : [];

  /**
   * KO'CHIRISH ro'yxati — boshqa sinfdagi faol o'quvchilar.
   *
   * Joriy sinf nomi ham olinadi: admin kimni qaysi sinfdan olayotganini
   * TUGMANI BOSISHDAN OLDIN ko'rishi kerak. Nom ko'rsatilmasa bu amal yana
   * "jimgina ko'chirish" ga aylanib qolardi.
   */
  const otherClassStudents = canWrite
    ? await db.student.findMany({
        where: {
          status: "ACTIVE",
          classId: { not: null },
          NOT: { classId: klass.id },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          class: { select: { name: true } },
        },
        take: 300,
      })
    : [];

  // Xato kodlari endi aniq matnga bog'langan. Dinamik kalit (`t(key)`)
  // ishlatilmadi — kalit nomi kodda ko'rinib turishi kerak.
  const errorMessage =
    searchParams.error === "assign"
      ? t("assignFailed")
      : searchParams.error === "assignBlocked"
        ? t("assignBlockedOther")
        : searchParams.error === "move"
          ? t("moveFailed")
          : searchParams.error === "moveBlocked"
            ? t("moveNothing")
            : searchParams.error === "inUse"
              ? t("deleteBlocked")
              : undefined;

  const lessons = [...klass.lessons].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return (a.period?.index ?? 99) - (b.period?.index ?? 99);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{klass.name}</h1>
          <p className="text-muted-foreground">
            {t("gradeValue", { grade: klass.grade })} ·{" "}
            {klass.academicYear?.name ?? t("academicYearNone")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/classes">{t("back")}</Link>
          </Button>
          {canWrite ? (
            <Button asChild>
              <Link href={`/classes/${klass.id}/edit`}>{t("edit")}</Link>
            </Button>
          ) : null}
          {canWrite &&
          klass.students.length === 0 &&
          klass.lessons.length === 0 ? (
            <form action={deleteClass}>
              <input type="hidden" name="id" value={klass.id} />
              <Button type="submit" variant="outline">
                {t("delete")}
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("profile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">{t("homeroomTeacher")}: </span>
              {klass.homeroomTeacher?.user.fullName ?? t("homeroomNone")}
            </p>
            <p>
              <span className="text-muted-foreground">{t("studentsCount")}: </span>
              {klass.students.length}
            </p>
            <p>
              <span className="text-muted-foreground">{t("lessonsCount")}: </span>
              {klass.lessons.length}
            </p>
            <Button asChild variant="outline" className="mt-2">
              <Link href={`/schedule?view=class&classId=${klass.id}`}>
                {t("openSchedule")}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">{t("schedule")}</CardTitle>
            <CardDescription>{t("scheduleHint")}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {lessons.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">{t("scheduleEmpty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">{tSchedule("day")}</th>
                      <th className="px-4 py-3 font-medium">{tSchedule("period")}</th>
                      <th className="px-4 py-3 font-medium">{tSchedule("subject")}</th>
                      <th className="px-4 py-3 font-medium">{tSchedule("teacher")}</th>
                      <th className="px-4 py-3 font-medium">{tSchedule("room")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lessons.map((lesson) => (
                      <tr key={lesson.id} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          {DAYS.includes(lesson.dayOfWeek)
                            ? tSchedule(`days.${lesson.dayOfWeek}`)
                            : lesson.dayOfWeek}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {lesson.startTime}–{lesson.endTime}
                        </td>
                        <td className="px-4 py-3">{lesson.subject.nameUz}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {lesson.teacher.user.fullName}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {lesson.room ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("students")}</CardTitle>
          <CardDescription>{t("studentsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {klass.students.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("studentsEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {klass.students.map((student) => (
                    <tr key={student.id} className="border-b last:border-0">
                      <td className="py-2">
                        <Link
                          href={`/students/${student.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {student.lastName} {student.firstName}
                        </Link>
                      </td>
                      <td className="py-2 text-right">
                        {canWrite ? (
                          <form action={removeStudent}>
                            <input type="hidden" name="classId" value={klass.id} />
                            <input type="hidden" name="studentId" value={student.id} />
                            <Button type="submit" variant="outline">
                              {t("removeStudent")}
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canWrite ? (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">{t("addStudents")}</p>
              <p className="text-sm text-muted-foreground">{t("addStudentsHint")}</p>
              {unassigned.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noUnassigned")}</p>
              ) : (
                <form action={assignStudents} className="space-y-3">
                  <input type="hidden" name="classId" value={klass.id} />
                  <select
                    name="studentIds"
                    multiple
                    size={Math.min(8, unassigned.length)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {unassigned.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.lastName} {student.firstName}
                      </option>
                    ))}
                  </select>
                  <Button type="submit">{t("addStudentsAction")}</Button>
                </form>
              )}
            </div>
          ) : null}

          {canWrite ? (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">{t("moveStudents")}</p>
              <p className="text-sm text-muted-foreground">{t("moveStudentsHint")}</p>
              {otherClassStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("noOtherClassStudents")}
                </p>
              ) : (
                <form action={moveStudents} className="space-y-3">
                  <input type="hidden" name="classId" value={klass.id} />
                  <select
                    name="studentIds"
                    multiple
                    size={Math.min(8, otherClassStudents.length)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {otherClassStudents.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.lastName} {student.firstName}
                        {student.class ? ` — ${student.class.name}` : ""}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline">
                    {t("moveStudentsAction")}
                  </Button>
                </form>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
