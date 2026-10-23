import type { CreditTerms } from "@/lib/api";

export interface ResolvedCreditTerms {
  amount: number | null;
  rate: number | null;
  termMonths: number | null;
  monthlyPayment: number | null;
  overpayment: number | null;
  totalPayment: number | null;
}

const finiteNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function resolveCreditTerms(terms?: CreditTerms | null): ResolvedCreditTerms {
  return {
    amount: finiteNumber(terms?.amount),
    rate: finiteNumber(terms?.rate),
    termMonths: finiteNumber(terms?.termMonths),
    monthlyPayment: finiteNumber(terms?.monthlyPayment),
    overpayment: finiteNumber(terms?.overpayment),
    totalPayment: finiteNumber(terms?.totalPayment),
  };
}

export function creditTermsSnapshotError(terms?: CreditTerms | null): string | null {
  const resolved = resolveCreditTerms(terms);
  if (resolved.amount === null || resolved.amount <= 0) return "Не указана корректная сумма основного долга.";
  if (resolved.rate === null || resolved.rate < 0) return "Не указана корректная годовая ставка.";
  if (resolved.termMonths === null || !Number.isInteger(resolved.termMonths) || resolved.termMonths <= 0) return "Не указан корректный срок кредита.";
  if (resolved.monthlyPayment === null || resolved.monthlyPayment < 0) return "Не указан корректный ежемесячный платёж.";
  if (resolved.overpayment === null || resolved.overpayment < 0) return "Не указана корректная переплата.";
  if (resolved.totalPayment === null || resolved.totalPayment < resolved.amount) return "Не указана корректная общая выплата.";
  if (terms?.paymentType !== "ANNUITY") return "Не указан поддерживаемый тип платежа.";
  if (terms.feesIncluded !== false) return "Не зафиксировано отсутствие комиссий в расчёте.";
  if (!terms.validUntil || !Number.isFinite(Date.parse(terms.validUntil))) return "Не указан корректный срок действия предложения.";
  const expectedTotal = Math.round((resolved.amount + resolved.overpayment) * 100) / 100;
  if (expectedTotal !== Math.round(resolved.totalPayment * 100) / 100) return "Общая выплата не соответствует сумме долга и переплате.";
  return null;
}

export function paymentTypeLabel(value?: string | null) {
  if (!value) return "Не указан";
  const normalized = value.toUpperCase();
  if (normalized === "ANNUITY" || normalized === "ANNUITET") return "Аннуитетный";
  if (normalized === "DIFFERENTIATED" || normalized === "DIFFERENTIAL") return "Дифференцированный";
  return value;
}

export function validUntilLabel(value?: string | null) {
  if (!value) return "Срок действия не указан";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Срок действия указан некорректно";
  return `до ${date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}`;
}

export const ECONOMICS_DISCLOSURE =
  "Комиссии, страхование, штрафы и иные платежи в демонстрационной модели не рассчитываются и не включены. Общая выплата не является ПСК или юридической офертой.";
