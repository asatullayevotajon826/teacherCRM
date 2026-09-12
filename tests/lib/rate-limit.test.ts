import { describe, expect, it } from "vitest";
import { estimateCount, windowsFor } from "@/lib/rate-limit-window";
import {
  ipKeyFor,
  loginKeyFor,
  loginKeyHash,
  normalizeLogin,
} from "@/lib/rate-limit-keys";

/**
 * SO'ROV CHEKLOVI TESTLARI (PR G4c)
 * =================================
 *
 * Bu testlar bazaga TEGMAYDI — ataylab. Tekshirilayotgan narsa SQL emas,
 * balki cheklov QARORI: qancha urinish hisoblanadi va kalitda nima
 * turadi. Aynan shu ikki joydagi xato jimgina ketadi: ilova ishlaydi, log
 * toza bo'ladi, faqat himoya yo'q bo'ladi.
 */

const MINUTE = 60_000;

describe("windowsFor", () => {
  it("oynani chegaraga tekislaydi va oldingi oynani to'g'ri beradi", () => {
    const { current, previous } = windowsFor(MINUTE, 1_700_000_045_000);

    expect(current.getTime() % MINUTE).toBe(0);
    expect(previous.getTime()).toBe(current.getTime() - MINUTE);
  });

  it("o'qish va yozish bir xil oynaga tushadi", () => {
    // Ikki chaqiruv bir oyna ichida bo'lsa, katakcha ham bir xil bo'lishi
    // shart — aks holda yozilgan urinish hisobdan chetda qolardi.
    const a = windowsFor(MINUTE, 1_700_000_001_000);
    const b = windowsFor(MINUTE, 1_700_000_059_999);

    expect(a.current.getTime()).toBe(b.current.getTime());
  });

  it("oyna boshida oldingi hisob to'liq, oxirida deyarli nol", () => {
    const boshi = windowsFor(MINUTE, 1_700_000_040_000);
    const oxiri = windowsFor(MINUTE, 1_700_000_099_000);

    expect(boshi.previousWeight).toBeCloseTo(1, 5);
    expect(oxiri.previousWeight).toBeCloseTo(1 / 60, 5);
  });

  it("vazn har doim 0..1 oralig'ida", () => {
    for (let offset = 0; offset < MINUTE; offset += 3_137) {
      const { previousWeight } = windowsFor(MINUTE, 1_700_000_040_000 + offset);
      expect(previousWeight).toBeGreaterThanOrEqual(0);
      expect(previousWeight).toBeLessThanOrEqual(1);
    }
  });

  it("noto'g'ri oyna uzunligida xato tashlaydi (jimgina o'chib qolmaydi)", () => {
    expect(() => windowsFor(0)).toThrow();
    expect(() => windowsFor(-1)).toThrow();
    expect(() => windowsFor(Number.NaN)).toThrow();
    expect(() => windowsFor(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("estimateCount", () => {
  it("oyna chegarasidagi portlashni to'sadi", () => {
    // Qat'iy oynada bu hujum ishlardi: oxirgi soniyada 40 ta, keyin yangi
    // oynada yana 40 ta — bir soniyada 80 so'rov. Yangi oyna boshlanganiga
    // 1 soniya bo'lgan holatni tekshiramiz.
    const { previousWeight } = windowsFor(MINUTE, 1_700_000_061_000);
    const limit = 40;

    expect(estimateCount(1, 40, previousWeight)).toBeGreaterThan(limit);
  });

  it("oldingi oyna to'liq chiqib ketsa faqat joriy hisob qoladi", () => {
    expect(estimateCount(5, 40, 0)).toBe(5);
  });

  it("vaznni qo'llaydi", () => {
    expect(estimateCount(10, 40, 0.5)).toBe(30);
  });

  it("buzilgan qiymatlar chegarani YUMSHATMAYDI", () => {
    // Manfiy yoki NaN qiymat hisobni kamaytirib, cheklovni ochib
    // yuborishi mumkin edi — shuning uchun 0 ga tenglashtiriladi.
    expect(estimateCount(-100, 0, 0)).toBe(0);
    expect(estimateCount(3, -100, 1)).toBe(3);
    expect(estimateCount(Number.NaN, 0, 0)).toBe(0);
    expect(estimateCount(3, 0, Number.NaN)).toBe(3);

    // Noaniq vazn eng QATTIQ variantga tushadi (1), yumshoq (0) emas.
    expect(estimateCount(0, 10, Number.NaN)).toBe(10);
  });

  it("hech qachon manfiy qaytmaydi", () => {
    expect(estimateCount(-5, -5, -5)).toBeGreaterThanOrEqual(0);
  });
});

describe("login kaliti — maxfiylik", () => {
  const EMAIL = "Admin@Maktab.uz";
  const PHONE = "+998901234567";

  it("kalitda ochiq email yoki telefon TURMAYDI", () => {
    const emailKey = loginKeyFor(EMAIL);
    const phoneKey = loginKeyFor(PHONE);

    expect(emailKey).not.toContain("Admin");
    expect(emailKey.toLowerCase()).not.toContain("admin");
    expect(emailKey).not.toContain("maktab");
    expect(emailKey).not.toContain("@");
    expect(phoneKey).not.toContain("998");
    expect(phoneKey).not.toContain("901234567");
  });

  it("faqat prefiks va olti burchakli xeshdan iborat", () => {
    expect(loginKeyFor(EMAIL)).toMatch(/^login:[0-9a-f]{32}$/);
  });

  it("bir xil login — bir xil kalit (cheklov ishlashi uchun shart)", () => {
    expect(loginKeyHash(EMAIL)).toBe(loginKeyHash(EMAIL));
  });

  it("registr va bo'sh joy bilan chegarani chetlab o'tib bo'lmaydi", () => {
    // Aks holda hujumchi har safar yozilishini o'zgartirib yangi
    // hisoblagich olardi va 5 urinish chegarasi cheksiz bo'lardi.
    expect(loginKeyFor("  ADMIN@maktab.uz ")).toBe(loginKeyFor("admin@maktab.uz"));
    expect(normalizeLogin(" A@B.uz ")).toBe("a@b.uz");
  });

  it("boshqa login — boshqa kalit", () => {
    expect(loginKeyFor("a@maktab.uz")).not.toBe(loginKeyFor("b@maktab.uz"));
  });
});

describe("IP kaliti", () => {
  it("IP bo'lmasa ham kalit yasaydi (cheklovsiz qolmaydi)", () => {
    expect(ipKeyFor("")).toBe("ip:unknown");
    expect(ipKeyFor("   ")).toBe("ip:unknown");
  });

  it("IP ni prefiks bilan beradi", () => {
    expect(ipKeyFor("203.0.113.7")).toBe("ip:203.0.113.7");
  });

  it("login va IP kalitlari aralashmaydi", () => {
    expect(ipKeyFor("203.0.113.7").startsWith("ip:")).toBe(true);
    expect(loginKeyFor("a@b.uz").startsWith("login:")).toBe(true);
  });
});
