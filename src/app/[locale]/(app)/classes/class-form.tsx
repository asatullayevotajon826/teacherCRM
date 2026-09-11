"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GRADES } from "@/lib/classes";
import { createClass, updateClass, type ClassFormState } from "./actions";

type Option = { id: string; label: string };

type ClassFormProps = {
  mode: "create" | "edit";
  academicYears: Option[];
  teachers: Option[];
  /** Yangi sinfda oldindan tanlanadigan o'quv yili (joriy yil). */
  defaultAcademicYearId?: string | null;
  klass?: {
    id: string;
    name: string;
    grade: number;
    academicYearId: string | null;
    homeroomTeacherId: string | null;
  };
};

function SubmitButton({
  mode,
  disabled,
}: {
  mode: "create" | "edit";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const t = useTranslations("classes");
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? t("saving") : mode === "create" ? t("create") : t("save")}
    </Button>
  );
}

export function ClassForm({
  mode,
  academicYears,
  teachers,
  defaultAcademicYearId,
  klass,
}: ClassFormProps) {
  const t = useTranslations("classes");
  const tYears = useTranslations("academicYears");
  const action = mode === "create" ? createClass : updateClass;
  const [state, formAction] = useFormState<ClassFormState, FormData>(action, {});

  // Redirectdan keyin state undefined bo'lishi mumkin.
  const errorMessage = state?.error;

  /*
   * O'QUV YILI MAJBURIY (PR F2).
   *
   * Ilgari ro'yxatda "tanlanmagan" varianti bor edi va sinf o'quv yilisiz
   * saqlanardi. Bu holda sxemadagi @@unique([name, academicYearId]) qoidasi
   * ishlamay qolardi (NULL o'zi bilan teng emas) — bir xil nomli sinflar
   * takrorlanib ketardi. Endi bo'sh variant yo'q; bazada ham NOT NULL.
   *
   * Bazada birorta o'quv yili bo'lmasa forma saqlanmaydi — shuning uchun
   * tugma o'chiriladi va foydalanuvchi avval yil yaratishga yo'naltiriladi.
   */
  const noYears = academicYears.length === 0;

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && klass ? (
        <input type="hidden" name="id" value={klass.id} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">{t("name")}</Label>
          <Input
            id="name"
            name="name"
            required
            placeholder="9-A"
            defaultValue={klass?.name ?? ""}
          />
          <p className="text-xs text-muted-foreground">{t("nameHint")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="grade">{t("grade")}</Label>
          <select
            id="grade"
            name="grade"
            defaultValue={klass?.grade ?? 1}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                {t("gradeValue", { grade })}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="academicYearId">{t("academicYear")}</Label>
          <select
            id="academicYearId"
            name="academicYearId"
            required
            defaultValue={
              klass?.academicYearId ?? defaultAcademicYearId ?? ""
            }
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {/* Bo'sh variant faqat "hali tanlanmagan" holatini ko'rsatadi va
                yuborib bo'lmaydi (disabled + required). */}
            <option value="" disabled>
              —
            </option>
            {academicYears.map((year) => (
              <option key={year.id} value={year.id}>
                {year.label}
              </option>
            ))}
          </select>
          {/* Ro'yxatda faqat bazadagi o'quv yillari bo'ladi — yangi yilni
              shu havola orqali qo'shish mumkin. */}
          {noYears ? (
            <p className="text-xs text-destructive">{tYears("empty")}</p>
          ) : null}
          <Link
            href="/academic-years"
            className="text-xs text-primary hover:underline"
          >
            {tYears("title")}
          </Link>
        </div>
        <div className="space-y-2">
          <Label htmlFor="homeroomTeacherId">{t("homeroomTeacher")}</Label>
          <select
            id="homeroomTeacherId"
            name="homeroomTeacherId"
            defaultValue={klass?.homeroomTeacherId ?? ""}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t("homeroomNone")}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {errorMessage ? (
        <p className="text-sm font-medium text-destructive">{errorMessage}</p>
      ) : null}

      <div className="flex gap-2">
        <SubmitButton mode={mode} disabled={noYears} />
        <Button asChild variant="outline">
          <Link href={klass ? `/classes/${klass.id}` : "/classes"}>
            {t("cancel")}
          </Link>
        </Button>
      </div>
    </form>
  );
}
