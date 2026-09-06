"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImportOutcome, PreviewResult } from "@/lib/imports";

/**
 * IMPORT USTASI (o'quvchi va o'qituvchi uchun bir xil)
 * ===================================================
 * 1. Shablonni yuklab olish
 * 2. Excel faylni tanlash → server faylni tekshiradi (bazaga yozmaydi)
 * 3. Jadvalni ko'rib chiqish → dublikat siyosatini tanlash → tasdiqlash
 *
 * Server action'lar prop sifatida keladi — shu tufayli bitta UI ikki
 * bo'limga xizmat qiladi.
 *
 * TRow — qator tipi (StudentCommitRow yoki TeacherCommitRow). Komponent
 * generic: aks holda o'quvchi/o'qituvchi action'larining aniq tiplari
 * `PreviewResult<unknown>` bilan mos kelmaydi.
 */

type PreviewState<TRow> =
  | { ok: true; data: PreviewResult<TRow> }
  | { ok: false; error: string };

type CommitState = { ok: true; data: ImportOutcome } | { ok: false; error: string };

export type ImportWizardProps<TRow> = {
  templateHref: string;
  listHref: string;
  templateColumns: string[];
  preview: (
    prev: PreviewState<TRow> | null,
    formData: FormData
  ) => Promise<PreviewState<TRow>>;
  commit: (payload: unknown) => Promise<CommitState>;
};

const MAX_VISIBLE_ROWS = 200;

/**
 * `src/lib/excel.ts` dagi DANGEROUS_CELL_START ning nusxasi.
 *
 * NIMA UCHUN NUSXA: `excel.ts` `xlsx` paketini import qiladi, bu fayl esa
 * "use client". Undan import qilsak butun `xlsx` brauzer bundle'iga tushib
 * qolardi (yuzlab kilobayt + keraksiz hujum yuzasi).
 *
 * IKKALA REGEX BIR XIL BO'LIB QOLISHI SHART — birini o'zgartirsang,
 * ikkinchisini ham o'zgartir.
 */
const DANGEROUS_CELL_START = /^[=+\-@\t\r]/;

/**
 * CSV formula injection himoyasi. Excel/LibreOffice `=`, `+`, `-`, `@`
 * bilan boshlangan katakni FORMULA deb bajaradi. Import qilinayotgan
 * Excel'dagi F.I.Sh. hujumchi nazoratida bo'lishi mumkin, shuning uchun
 * bu faylga tushishidan oldin boshiga apostrof qo'yiladi.
 */
function sanitizeCsvCell(value: string): string {
  if (value === "") return value;
  return DANGEROUS_CELL_START.test(value) ? `'${value}` : value;
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          // TARTIB MUHIM: avval formula neytrallanadi, keyin qo'shtirnoqqa
          // olinadi. Teskari tartibda apostrof qo'shtirnoq ichida qolib,
          // Excel katakni yana formula deb o'qishi mumkin.
          const value = sanitizeCsvCell(cell ?? "");
          return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(";")
    )
    .join("\n");
}

function downloadCsv(fileName: string, rows: string[][]) {
  // BOM — Excel kirill/lotin harflarni to'g'ri ko'rsatishi uchun.
  const blob = new Blob(["\uFEFF", toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportWizard<TRow>({
  templateHref,
  listHref,
  templateColumns,
  preview,
  commit,
}: ImportWizardProps<TRow>) {
  const t = useTranslations("import");
  const [state, setState] = useState<PreviewState<TRow> | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [isPending, startTransition] = useTransition();

  const result = state?.ok ? state.data : null;

  function handleUpload(formData: FormData) {
    setOutcome(null);
    setCommitError(null);
    startTransition(async () => {
      setState(await preview(null, formData));
    });
  }

  function handleCommit() {
    if (!result) return;
    const rows = result.rows.filter((row) => row.row !== null).map((row) => row.row);
    if (rows.length === 0) {
      setCommitError(t("noReadyRows"));
      return;
    }

    setCommitError(null);
    startTransition(async () => {
      const response = await commit({ mode, fileName: result.fileName, rows });
      if (response.ok) {
        setOutcome(response.data);
        setState(null);
      } else {
        setCommitError(response.error);
      }
    });
  }

  function handleErrorReport() {
    if (!result) return;
    const rows: string[][] = [[t("row"), t("name"), t("messages")]];
    result.rows
      .filter((row) => row.status === "error")
      .forEach((row) => {
        rows.push([String(row.rowNumber), row.label, row.messages.join(" | ")]);
      });
    downloadCsv("import-xatolar.csv", rows);
  }

  function handleCredentials() {
    if (!outcome || outcome.credentials.length === 0) return;
    const rows: string[][] = [[t("name"), t("login"), t("password")]];
    outcome.credentials.forEach((item) => {
      rows.push([item.name, item.login, item.password]);
    });
    downloadCsv("login-parollar.csv", rows);
  }

  const statusLabel: Record<string, string> = {
    ready: t("statusReady"),
    duplicate: t("statusDuplicate"),
    error: t("statusError"),
  };

  const statusClass: Record<string, string> = {
    ready: "text-green-600",
    duplicate: "text-amber-600",
    error: "text-destructive",
  };

  return (
    <div className="space-y-4">
      {/* 1-2 qadam: shablon va fayl */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stepUpload")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("uploadHint")}</p>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={templateHref}>{t("downloadTemplate")}</a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={listHref}>{t("backToList")}</Link>
            </Button>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <span className="font-medium">{t("columns")}: </span>
            {templateColumns.join(" · ")}
          </div>

          <form
            action={handleUpload}
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls"
              required
              className="block w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-accent file:px-3 file:py-1 file:text-sm"
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? t("checking") : t("check")}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">{t("limits")}</p>
        </CardContent>
      </Card>

      {state && !state.ok ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {/* 3-qadam: ko'rib chiqish */}
      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("previewTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{result.fileName}</p>

            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">{t("total")}</span>
                <span className="font-medium">{result.total}</span>
              </div>
              <div className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">{t("ready")}</span>
                <span className="font-medium text-green-600">{result.ready}</span>
              </div>
              <div className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">{t("duplicates")}</span>
                <span className="font-medium text-amber-600">{result.duplicates}</span>
              </div>
              <div className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">{t("errors")}</span>
                <span className="font-medium text-destructive">{result.errors}</span>
              </div>
            </div>

            {result.unknownColumns.length > 0 ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700">
                {t("unknownColumns")}: {result.unknownColumns.join(", ")}
              </p>
            ) : null}

            {/* Dublikat siyosati */}
            {result.duplicates > 0 ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t("modeTitle")}</p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "skip"}
                    onChange={() => setMode("skip")}
                    className="mt-1"
                  />
                  <span>{t("modeSkip")}</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "update"}
                    onChange={() => setMode("update")}
                    className="mt-1"
                  />
                  <span>{t("modeUpdate")}</span>
                </label>
              </div>
            ) : null}

            {/* Qatorlar jadvali */}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{t("row")}</th>
                    <th className="px-3 py-2">{t("name")}</th>
                    <th className="px-3 py-2">{t("detail")}</th>
                    <th className="px-3 py-2">{t("statusColumn")}</th>
                    <th className="px-3 py-2">{t("messages")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, MAX_VISIBLE_ROWS).map((row) => (
                    <tr key={row.rowNumber} className="border-t align-top">
                      <td className="px-3 py-2 text-muted-foreground">{row.rowNumber}</td>
                      <td className="px-3 py-2 font-medium">{row.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.detail}</td>
                      <td className={`px-3 py-2 font-medium ${statusClass[row.status]}`}>
                        {statusLabel[row.status]}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.messages.join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.rows.length > MAX_VISIBLE_ROWS ? (
              <p className="text-xs text-muted-foreground">
                {t("moreRows", { count: result.rows.length - MAX_VISIBLE_ROWS })}
              </p>
            ) : null}

            {commitError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {commitError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleCommit} disabled={isPending}>
                {isPending ? t("importing") : t("confirm")}
              </Button>
              {result.errors > 0 ? (
                <Button variant="outline" onClick={handleErrorReport} type="button">
                  {t("downloadErrors")}
                </Button>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">{t("confirmHint")}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Natija */}
      {outcome ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("resultTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">{t("created")}</span>
                <span className="font-medium text-green-600">{outcome.created}</span>
              </div>
              <div className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">{t("updated")}</span>
                <span className="font-medium">{outcome.updated}</span>
              </div>
              <div className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">{t("skipped")}</span>
                <span className="font-medium text-amber-600">{outcome.skipped}</span>
              </div>
              <div className="rounded-md border p-2">
                <span className="block text-xs text-muted-foreground">{t("failed")}</span>
                <span className="font-medium text-destructive">{outcome.failed}</span>
              </div>
            </div>

            {outcome.messages.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {outcome.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}

            {outcome.credentials.length > 0 ? (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-sm font-medium">{t("credentialsTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("credentialsHint")}</p>
                <Button size="sm" variant="outline" onClick={handleCredentials} type="button">
                  {t("downloadCredentials")}
                </Button>
              </div>
            ) : null}

            <Button asChild variant="outline" size="sm">
              <Link href={listHref}>{t("backToList")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
