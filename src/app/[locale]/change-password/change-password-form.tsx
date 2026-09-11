"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { changePassword } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH, passwordRuleText } from "@/lib/password";
import type { ActionResult } from "@/lib/safe-action";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("changePassword");
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t("saving") : t("submit")}
    </Button>
  );
}

export function ChangePasswordForm() {
  const t = useTranslations("changePassword");
  const locale = useLocale();
  const [state, formAction] = useFormState<ActionResult | undefined, FormData>(
    changePassword,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">{t("currentLabel")}</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword">{t("newLabel")}</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          // Brauzerdagi tekshiruv faqat QULAYLIK uchun — haqiqiy qaror
          // serverda (`passwordSchema`) qabul qilinadi.
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("confirmLabel")}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
      </div>

      {state && !state.ok && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}

      {/*
        Qoida matni kodda turadi (`passwordRuleText`), tarjima faylida emas:
        matn ichida minimal uzunlik raqami bor va u chegara bilan birga
        avtomatik o'zgarishi kerak. Aks holda forma "8 belgi yetadi" deb
        yozib turib, server rad etib, foydalanuvchi sababini tushunmaydi.
      */}
      <p className="text-xs text-muted-foreground">{passwordRuleText(locale)}</p>

      <SubmitButton />
    </form>
  );
}
