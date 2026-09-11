"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH, passwordRuleText } from "@/lib/password";
import {
  createTeacher,
  updateTeacher,
  type TeacherFormState,
} from "./actions";

type SubjectOption = { id: string; name: string };

type TeacherFormProps = {
  mode: "create" | "edit";
  subjects: SubjectOption[];
  teacher?: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    locale: string;
    isActive: boolean;
    subjectIds: string[];
  };
};

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const t = useTranslations("teachers");
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t("saving") : mode === "create" ? t("create") : t("save")}
    </Button>
  );
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export function TeacherForm({ mode, subjects, teacher }: TeacherFormProps) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const action = mode === "create" ? createTeacher : updateTeacher;
  const [state, formAction] = useFormState<TeacherFormState, FormData>(
    action,
    {}
  );
  const selected = new Set(teacher?.subjectIds ?? []);

  return (
    <form action={formAction} className="space-y-4">
      {mode === "edit" && teacher ? (
        <input type="hidden" name="id" value={teacher.id} />
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="fullName">{t("fullName")}</Label>
        <Input
          id="fullName"
          name="fullName"
          required
          defaultValue={teacher?.fullName}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={teacher?.email ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={teacher?.phone ?? ""}
            placeholder="+998901234567"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("loginHint")}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="locale">{t("locale")}</Label>
          <select
            id="locale"
            name="locale"
            defaultValue={teacher?.locale ?? "uz"}
            className={selectClass}
          >
            <option value="uz">{t("localeUz")}</option>
            <option value="ru">{t("localeRu")}</option>
            <option value="en">{t("localeEn")}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="isActive">{t("status")}</Label>
          <div className="flex h-10 items-center gap-2">
            <input
              id="isActive"
              name="isActive"
              type="checkbox"
              defaultChecked={teacher ? teacher.isActive : true}
              className="h-4 w-4 rounded border-input"
            />
            <span className="text-sm text-muted-foreground">
              {t("statusActiveHint")}
            </span>
          </div>
        </div>
      </div>

      {mode === "create" ? (
        <div className="space-y-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="text"
            required
            // Serverdagi `passwordSchema` bilan bir xil chegara — admin
            // formani to'ldirayotib qoidani darhol ko'rsin.
            minLength={MIN_PASSWORD_LENGTH}
          />
          {/*
            Qoida matni kodda (`passwordRuleText`): ichida minimal uzunlik
            raqami bor, u chegara bilan birga avtomatik o'zgarishi kerak.
          */}
          <p className="text-xs text-muted-foreground">
            {passwordRuleText(locale)}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("passwordEditHint")}</p>
      )}

      <div className="space-y-2">
        <Label>{t("subjects")}</Label>
        {subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("subjectsEmpty")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {subjects.map((subject) => (
              <label
                key={subject.id}
                className="flex items-center gap-2 rounded-md border p-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="subjectIds"
                  value={subject.id}
                  defaultChecked={selected.has(subject.id)}
                  className="h-4 w-4 rounded border-input"
                />
                {subject.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {state.error ? (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      ) : null}

      <SubmitButton mode={mode} />
    </form>
  );
}
