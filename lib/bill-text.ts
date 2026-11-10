import type { ScannedBill } from "./bills";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function parsedDate(text: string, fallback: string) {
  const match = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/) || text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (!match) return fallback;
  const yearFirst = match[1].length === 4;
  const [year, month, day] = yearFirst ? [Number(match[1]), Number(match[2]), Number(match[3])] : [Number(match[3]), Number(match[2]), Number(match[1])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : fallback;
}

function amountOnLine(line: string) {
  const amounts = [...line.matchAll(/(?:^|\s|[:=])(?:Rs\.?\s*|LKR\s*|\$\s*)?([\d,]+\.\d{2})(?!\d)/gi)];
  if (!amounts.length) {
    const integers = [...line.matchAll(/(?:^|\s|[:=])(?:Rs\.?\s*|LKR\s*|\$\s*)?([\d,]{1,12})(?![\d.])/gi)];
    const value = integers.at(-1)?.[1];
    return value ? Number(value.replaceAll(",", "")) : 0;
  }
  const value = amounts.at(-1)?.[1];
  return value ? Number(value.replaceAll(",", "")) : 0;
}

export function parseBillText(text: string, options: { dateFallback?: string } = {}): ScannedBill {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstName = lines.find(line => {
    const letters = line.match(/[a-z]/gi)?.length || 0;
    const digits = line.match(/\d/g)?.length || 0;
    return /[a-z]{4,}/i.test(line) && letters / Math.max(1, letters + digits) >= 0.7
      && !/^(invoice|receipt|bill|tax\s+invoice|date|tel|phone|address|www\.|sale|purchase|payment|amount|total|visa|mastercard|terminal|merchant\s+id)\b/i.test(line);
  });
  const merchant = (firstName || "").replace(/^\d+\)\s*/, "").replace(/^[^a-z0-9]+/i, "").replace(/\s+[I|]$/, "").trim().slice(0, 180);
  const labeledAmounts = lines.map((line, index) => {
    const nextLine = lines[index + 1] || "";
    const amount = amountOnLine(line) || (/^(?:LKR|Rs\.?)?\s*[\d,]+(?:\.\d{2})?\s*$/i.test(nextLine) ? amountOnLine(nextLine) : 0);
    return { line, amount };
  }).filter(item => item.amount > 0 && !/\b(subtotal|sub\s*total|tax\s+total|total\s+items|discount)\b/i.test(item.line));
  const finalTotals = labeledAmounts.filter(item => /\b(grand\s+total|amount\s+paid|total\s+due|net\s+total|total)\b/i.test(item.line));
  const paymentAmounts = labeledAmounts.filter(item => /\b(amount|purchase|paid|payment)\b/i.test(item.line) && !/\b(tax|tip|change|cash\s+tendered)\b/i.test(item.line));
  const total = finalTotals.at(-1)?.amount || paymentAmounts.at(-1)?.amount || 0;
  const currency = /\b(?:USD|US\$)\b|\$/i.test(text) && !/\b(?:LKR|Rs\.?)\b/i.test(text) ? "USD" : "LKR";
  const lower = text.toLowerCase();
  const category = /subscription|renewal|monthly plan|annual plan/.test(lower) ? "Subscriptions"
    : /grocery|supermarket|market|vegetable|food|restaurant|cafe/.test(lower) ? "Food & drink"
    : /fuel|petrol|taxi|uber|bus fare/.test(lower) ? "Transport"
    : /electricity|water bill|internet bill|utility/.test(lower) ? "Bills"
    : /pharmacy|hospital|clinic/.test(lower) ? "Health"
    : /pen drive|computer|electronics/.test(lower) ? "Shopping" : "Other";
  return { merchant, date: parsedDate(text, options.dateFallback ?? today()), total, currency, category, items: [] };
}
