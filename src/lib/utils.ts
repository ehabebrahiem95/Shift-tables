/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// 1. القائمة الممنوعة (الأزواج)
export const BLOCKED_PAIRS = [
  ["جهاد احمد جمعه", "كريم سعيد محمد جاد"],
  ["اسماء جمال السيد", "عمر خالد فاضل"]
];

// 2. دالة تنظيف النصوص لضمان دقة البحث والمقارنة
export function normalizeText(t: string | any): string {
  if (!t) return "";
  return t.toString().toLowerCase().trim()
    .replace(/\s+/g, '') 
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىي]/g, "ي");
}

// فحص التضارب
export function checkPairConflict(name1: string, name2: string): string | null {
  const norm1 = normalizeText(name1);
  const norm2 = normalizeText(name2);
  
  for (const pair of BLOCKED_PAIRS) {
    const p1 = normalizeText(pair[0]);
    const p2 = normalizeText(pair[1]);
    
    if ((norm1 === p1 && norm2 === p2) || (norm1 === p2 && norm2 === p1)) {
      return `⚠️ تضارب! ${name1} لا يمكنه العمل مع ${name2}`;
    }
  }
  return null;
}
