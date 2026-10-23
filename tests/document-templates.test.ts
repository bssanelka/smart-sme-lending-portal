import { describe, expect, it } from "vitest";
import { buildDecisionEconomics } from "../server/calculator";
import { buildDocumentPackage, buildPaymentSchedule, documentContentHash } from "../server/document-templates";

const roundMoney = (value: number) => Math.round(value * 100) / 100;

function totals(rows: ReturnType<typeof buildPaymentSchedule>) {
  return rows.reduce((sum, row) => ({
    payment: roundMoney(sum.payment + row.payment),
    interest: roundMoney(sum.interest + row.interest),
    principal: roundMoney(sum.principal + row.principal),
  }), { payment: 0, interest: 0, principal: 0 });
}

describe("verifiable document package", () => {
  it("builds a monthly schedule reconciled with the final offer", () => {
    const economics = { amount: 1_000_000, rate: 20, termMonths: 12, ...buildDecisionEconomics(1_000_000, 20, 12, "2026-10-20T00:00:00.000Z") };
    const schedule = buildPaymentSchedule(economics, "2026-10-20T00:00:00.000Z");

    expect(schedule).toHaveLength(12);
    expect(schedule.at(-1)?.balance).toBe(0);
    expect(totals(schedule)).toEqual({
      payment: economics.totalPayment,
      interest: economics.overpayment,
      principal: economics.amount,
    });
    expect(schedule[0].paymentDate).toBe("2026-11-20T00:00:00.000Z");
  });

  it("adjusts the final zero-rate payment without losing a kopeck", () => {
    const economics = { amount: 100, rate: 0, termMonths: 3, ...buildDecisionEconomics(100, 0, 3, "2026-01-31T00:00:00.000Z") };
    const schedule = buildPaymentSchedule(economics, "2026-01-31T00:00:00.000Z");

    expect(schedule.map((row) => row.payment)).toEqual([33.33, 33.33, 33.34]);
    expect(totals(schedule)).toEqual({ payment: 100, interest: 0, principal: 100 });
    expect(schedule.map((row) => row.paymentDate)).toEqual([
      "2026-02-28T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
      "2026-04-30T00:00:00.000Z",
    ]);
  });

  it("creates three semantically different versioned files with SHA-256 hashes", () => {
    const economics = { amount: 1_000_000, rate: 20, termMonths: 12, ...buildDecisionEconomics(1_000_000, 20, 12, "2026-10-20T00:00:00.000Z") };
    const documents = buildDocumentPackage({
      publicNo: "TEST-DOC-1",
      companyName: "ООО Тест",
      companyInn: "7700000000",
      companyHeadName: "Тест Тестов",
      productName: "Оборотный кредит",
      purpose: "Закупка товара",
      decisionReason: "Показатели подтверждены",
      decidedAt: "2026-10-20T00:00:00.000Z",
      generatedAt: "2026-10-21T00:00:00.000Z",
      economics,
    });

    expect(documents).toHaveLength(3);
    expect(new Set(documents.map((document) => document.content)).size).toBe(3);
    expect(new Set(documents.map((document) => document.contentHash)).size).toBe(3);
    expect(documents.every((document) => document.version === "credit-docs-v2")).toBe(true);
    expect(documents.every((document) => documentContentHash(document.content) === document.contentHash)).toBe(true);
    expect(documents.find((document) => document.kind === "График платежей")?.content).toContain("Основной долг, ₽");
    expect(documents.find((document) => document.kind === "Кредитный договор")?.content).toContain("ПРЕДМЕТ ДОГОВОРА");
    expect(documents.find((document) => document.kind === "Справка о состоянии счёта")?.content).toContain("Модельный лимит");
  });
});
