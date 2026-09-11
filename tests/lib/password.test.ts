import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordError,
  passwordRuleText,
  passwordSchema,
} from "@/lib/password";

/**
 * PAROL SIYOSATI TESTLARI (PR G1)
 * ===============================
 *
 * Maqsad: siyosat kelajakda tasodifan BO'SHASHTIRILMASIN. Agar kimdir
 * chegarani 12 dan pasaytirsa yoki zaif parol tekshiruvini olib tashlasa,
 * shu testlar darhol qizil bo'ladi.
 *
 * Testlarda ishlatilgan parollar — shartli namunalar, hech qanday haqiqiy
 * hisobga tegishli emas.
 */

describe("parol siyosati chegaralari", () => {
  it("minimal uzunlik 12 (pasaytirilmasin)", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it("maksimal uzunlik 128 (bcrypt jim qirqib tashlamasin)", () => {
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });
});

describe("to'g'ri parollar qabul qilinadi", () => {
  const yaxshi = [
    "Toshkent7Bahor",
    "Xavfsiz-Kalit-2026",
    "gulnoza7navoiy9kitob",
    "7Yanvar-Quyosh-Tong",
  ];

  for (const value of yaxshi) {
    it(`qabul qiladi: ${value}`, () => {
      expect(passwordError(value)).toBeNull();
      expect(passwordSchema.safeParse(value).success).toBe(true);
    });
  }
});

describe("qisqa parol rad etiladi", () => {
  it("11 belgi yetmaydi", () => {
    const value = "Abkr7mzqt5x"; // 11 belgi
    expect(value).toHaveLength(11);
    expect(passwordError(value)).toContain("12");
  });

  it("eski 8 belgili parol endi o'tmaydi", () => {
    expect(passwordError("Abkr7mzq")).not.toBeNull();
  });

  it("bo'sh qiymat rad etiladi", () => {
    expect(passwordError("")).not.toBeNull();
  });

  it("128 dan uzun parol rad etiladi", () => {
    const value = `A7${"xkqmzr".repeat(30)}`;
    expect(value.length).toBeGreaterThan(MAX_PASSWORD_LENGTH);
    expect(passwordError(value)).not.toBeNull();
  });
});

describe("harf va raqam talabi", () => {
  it("faqat harflardan iborat parol rad etiladi", () => {
    expect(passwordError("Toshkentbahorkuz")).not.toBeNull();
  });

  it("faqat raqamlardan iborat parol rad etiladi", () => {
    expect(passwordError("839204751628")).not.toBeNull();
  });
});

describe("lug'at hujumiga qarshi", () => {
  const zaif = [
    "Parol12345678",
    "password2026x",
    "Qwerty1234567",
    "admin123Maktab",
    "Iloveyou2026!",
    "welcome2026abc",
  ];

  for (const value of zaif) {
    it(`rad etadi: ${value}`, () => {
      expect(passwordError(value)).not.toBeNull();
    });
  }

  it("katta-kichik harf bilan yashirishga urinish ham to'xtatiladi", () => {
    expect(passwordError("PaSsWoRd2026x")).not.toBeNull();
  });
});

describe("naqsh (pattern) tekshiruvi", () => {
  it("bir xil belgi 4 marta takrorlanmaydi", () => {
    expect(passwordError("Toshkentaaaa7")).not.toBeNull();
  });

  it("3 marta takror ruxsat etiladi", () => {
    expect(passwordError("Toshkentaaa7b")).toBeNull();
  });

  it("ketma-ket oshib boruvchi qator rad etiladi", () => {
    expect(passwordError("Toshkentefghij")).not.toBeNull();
  });

  it("ketma-ket kamayib boruvchi qator rad etiladi", () => {
    expect(passwordError("Toshkent98765x")).not.toBeNull();
  });
});

describe("qoida matni", () => {
  it("uch tilda ham chegara raqamini ko'rsatadi", () => {
    for (const locale of ["uz", "ru", "en"]) {
      expect(passwordRuleText(locale)).toContain(String(MIN_PASSWORD_LENGTH));
    }
  });

  it("noma'lum til uchun o'zbekcha matn qaytaradi", () => {
    expect(passwordRuleText("tr")).toBe(passwordRuleText("uz"));
  });
});
