/**
 * HISOB-KITOB — YAGONA MANBA
 * ==========================
 *
 * Bu fayl baho/reyting matematikasining **yagona nusxasi**. Ilgari bir xil
 * mantiq uch faylda takrorlangan edi va ular bir-biridan ajralib ketgan edi:
 *
 *   averageOf   → grades.ts va ranking.ts da BAYT-BAYT bir xil ikki nusxa
 *   parseTopN   → ranking.ts va journal.ts da BOSHQACHA ishlaydigan ikki nusxa
 *   dense rank  → ranking.ts (`rankByScore`) va journal.ts (`rankByAverage`)
 *
 * NIMA UCHUN BU XAVFLI EDI (nusxa ko'chirishning asl narxi):
 *
 * `parseTopN` ikki nusxasi bir xil URL parametrini boshqacha tushunardi.
 * `?topN=7.9` yuborilsa:
 *
 *   ranking.ts → Math.trunc(7.9) = 7      → 7 daraja ko'rsatiladi
 *   journal.ts → Number.isInteger ❌ → null → BUTUN ro'yxat ko'rsatiladi
 *
 * Ya'ni bitta "buzuq" parametr bir sahifada chegarani qo'llardi, ikkinchisida
 * chegarani BUTUNLAY olib tashlardi. `parseTopN` ning maqsadi esa aynan
 * "URL ga qo'lda katta raqam yozib sahifani cho'ktirishning oldini olish"
 * edi — ya'ni himoya funksiyasining bir nusxasi o'z vazifasini bajarmasdi.
 * Bu xato hech bir testda ko'rinmasdi, chunki ikki funksiya ham alohida
 * "to'g'ri" ko'rinardi.
 *
 * Endi umumiy qoida: **kesish (trunc), rad etish emas.** Musbat son kelsa u
 * doim chegaraga aylanadi. Shunda "buzuq" qiymat hech qachon ro'yxatni
 * KENGAYTIRIB yubormaydi — eng yomon holatda ro'yxat torayadi.
 *
 * Bu faylning hech qanday importi YO'Q va bo'lmasligi kerak: u klient
 * komponentiga ham, Edge middleware'iga ham xavfsizlik bilan kiradi. Bazaga,
 * sessiyaga, `next/headers` ga murojaat qilinmaydi.
 */

/**
 * "Dastlabki N o'rin" ning yuqori chegarasi.
 *
 * URL ga `?topN=999999` yozib sahifani cho'ktirishning oldini oladi.
 */
export const MAX_TOP_N = 500;

/**
 * O'rtacha qiymat, bir kasrli aniqlikda.
 *
 * Bo'sh ro'yxatda `null` qaytadi — 0 deb ko'rsatish yolg'on bo'lardi:
 * "bahosi yomon" emas, "bahosi hali yo'q".
 */
export function averageOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

/**
 * Ballni 0–100 oralig'iga siqadi va bir kasrga yumaloqlaydi.
 *
 * Jarima ball katta bo'lsa yakuniy ball manfiyga tushib ketishi mumkin —
 * manfiy reyting balli ma'nosiz, shuning uchun 0 da to'xtaydi.
 */
export function clampScore(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 10) / 10;
}

/**
 * "Dastlabki N o'rin" maydonini o'qiydi (`searchParams` — ishonchsiz manba).
 *
 * Qoidalar:
 *   - bo'sh, matn-axlat yoki musbat bo'lmagan qiymat → `null` (chegara yo'q);
 *   - kasr son KESILADI: `"7.9"` → `7` (rad etilmaydi);
 *   - yuqori chegara `MAX_TOP_N`.
 *
 * `FormData` bir xil nomli maydonni massiv qilib berishi mumkin, shuning
 * uchun massivning birinchi elementi olinadi.
 */
export function parseTopN(value?: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;

  let text: string;
  if (typeof raw === "number") {
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.trim();
  } else {
    return null;
  }

  if (text === "") return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;

  const rounded = Math.trunc(parsed);
  if (rounded < 1) return null;

  return rounded > MAX_TOP_N ? MAX_TOP_N : rounded;
}

export type DenseRankRow = { id: string; value: number | null };

/**
 * O'rin belgilash — KETMA-KET (dense) usulda: 95, 95, 90, 85 → 1, 1, 2, 3.
 *
 * Egasining qat'iy talabi: bir xil ball bir xil o'rin oladi, undan keyingi
 * ball esa DARHOL keyingi o'rinni oladi. Sport turnirlarida boshqa qoida bor
 * (95, 95, 90 → 1, 1, 3), lekin maktab jurnalida o'rin "ball darajasi"
 * ma'nosini beradi.
 *
 * `value` `null` bo'lgan qator o'rinsiz qoladi va natijaga UMUMAN tushmaydi
 * — 0 deb hisoblash "yomon o'qiydi" degan yolg'on xulosa bo'lardi.
 *
 * `limit` berilsa faqat dastlabki N DARAJA belgilanadi. Bir darajada bir
 * necha bola bo'lishi mumkin, ya'ni natija `limit` dan ko'p qator qaytarishi
 * normal.
 *
 * Natija Map ning **kirish tartibi ballning kamayishi bo'yicha** — chaqiruvchi
 * kod shu tartibga tayanishi mumkin.
 */
export function denseRank(
  rows: DenseRankRow[],
  limit?: number | null
): Map<string, number> {
  const result = new Map<string, number>();

  const scored = rows
    .filter((row): row is { id: string; value: number } => row.value !== null)
    .sort((left, right) => right.value - left.value);

  const cap = limit !== null && limit !== undefined && limit > 0 ? limit : null;

  let place = 0;
  let previous: number | null = null;

  for (const row of scored) {
    // Yangi (kichikroq) ball — yangi daraja. Bir xil ball — avvalgi daraja.
    if (previous === null || row.value < previous) {
      place += 1;
      previous = row.value;
    }

    // Ro'yxat ball bo'yicha tartiblangani uchun bu yerdan keyin hammasi kichik.
    if (cap !== null && place > cap) break;

    result.set(row.id, place);
  }

  return result;
}
