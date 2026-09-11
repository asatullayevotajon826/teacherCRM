import { describe, expect, it } from "vitest";
import { isStrongInitialPassword } from "@/lib/import-commit-guards";
import { MIN_PASSWORD_LENGTH, passwordSchema } from "@/lib/password";

/**
 * IMPORT PAROL SIYOSATI
 * =====================
 *
 * Bu testlarning maqsadi bitta: import yo'li bilan forma yo'li o'rtasida
 * parol qoidasi HECH QACHON ajralib ketmasin. Ilgari aynan shu ajralish
 * bor edi — formada 12 belgi talab qilinardi, import esa 8 belgini qabul
 * qilardi, ya'ni eng zaif hisoblar ommaviy yo'ldan kirib kelardi.
 */
describe("import parol siyosati formadagi siyosat bilan bir xil", () => {
  const samples = [
    "Abkr7mzq",
    "Maktab12",
    "admin123",
    "Parol12345678",
    "Toshkent7Bahor",
    "gulnoza7navoiy9kitob",
    "Toshkentaaaa7",
    "Toshkent98765x",
    "12345678901234",
    "faqatharflarbor",
    "",
  ];

  it.each(samples)("%j uchun ikki yo'l bir xil qaror qabul qiladi", (value) => {
    expect(isStrongInitialPassword(value)).toBe(
      passwordSchema.safeParse(value).success
    );
  });
});

describe("import orqali zaif parol o'tmaydi", () => {
  it("eski 8 belgili parolni rad etadi", () => {
    expect(isStrongInitialPassword("Abkr7mzq")).toBe(false);
  });

  it("admin qo'yishi mumkin bo'lgan oson parollarni rad etadi", () => {
    expect(isStrongInitialPassword("Maktab12")).toBe(false);
    expect(isStrongInitialPassword("admin123Maktab")).toBe(false);
    expect(isStrongInitialPassword("Parol12345678")).toBe(false);
  });

  it("chegaradan bir belgi qisqa parolni rad etadi", () => {
    const short = `Abkr7mzqt${"5".repeat(MIN_PASSWORD_LENGTH - 10)}`;
    expect(short.length).toBe(MIN_PASSWORD_LENGTH - 1);
    expect(isStrongInitialPassword(short)).toBe(false);
  });

  it("kuchli parolni qabul qiladi", () => {
    expect(isStrongInitialPassword("Toshkent7Bahor")).toBe(true);
    expect(isStrongInitialPassword("Xavfsiz-Kalit-2026")).toBe(true);
  });
});
