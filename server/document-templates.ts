import { createHash } from "node:crypto";
import type { CompleteOfferEconomics } from "./calculator";

export const DOCUMENT_PACKAGE_VERSION = "credit-docs-v2";
export const REQUIRED_DOCUMENT_KINDS = [
  "Кредитный договор",
  "График платежей",
  "Справка о состоянии счёта",
] as const;

export type RequiredDocumentKind = typeof REQUIRED_DOCUMENT_KINDS[number];

export interface PaymentScheduleRow {
  number: number;
  paymentDate: string;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface DocumentPackageInput {
  publicNo: string;
  companyName: string;
  companyInn: string;
  companyHeadName: string;
  productName: string;
  purpose: string;
  decisionReason: string | null;
  decidedAt: string;
  generatedAt: string;
  economics: CompleteOfferEconomics;
}

export interface GeneratedDocument {
  kind: RequiredDocumentKind;
  filename: string;
  version: typeof DOCUMENT_PACKAGE_VERSION;
  content: string;
  contentHash: string;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Дата документа некорректна");
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
}

function addUtcMonths(value: string, months: number): string {
  const source = new Date(value);
  if (!Number.isFinite(source.getTime())) throw new Error("Дата начала графика некорректна");
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(source.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString();
}

export function buildPaymentSchedule(
  economics: CompleteOfferEconomics,
  firstPaymentBaseDate: string,
): PaymentScheduleRow[] {
  const monthlyRate = economics.rate / 1200;
  const rows: PaymentScheduleRow[] = [];
  let balance = roundMoney(economics.amount);
  let paid = 0;

  for (let number = 1; number <= economics.termMonths; number += 1) {
    const isFinal = number === economics.termMonths;
    const payment = isFinal
      ? roundMoney(economics.totalPayment - paid)
      : roundMoney(economics.monthlyPayment);
    let interest = roundMoney(balance * monthlyRate);
    let principal = roundMoney(payment - interest);

    if (isFinal) {
      principal = balance;
      interest = roundMoney(payment - principal);
    }
    if (principal < 0 || interest < 0 || principal > balance) {
      throw new Error(`Не удалось согласовать платёж №${number} с финансовым snapshot`);
    }

    balance = roundMoney(balance - principal);
    paid = roundMoney(paid + payment);
    rows.push({
      number,
      paymentDate: addUtcMonths(firstPaymentBaseDate, number),
      payment,
      interest,
      principal,
      balance,
    });
  }

  const totals = rows.reduce((sum, row) => ({
    payment: roundMoney(sum.payment + row.payment),
    interest: roundMoney(sum.interest + row.interest),
    principal: roundMoney(sum.principal + row.principal),
  }), { payment: 0, interest: 0, principal: 0 });
  if (totals.payment !== roundMoney(economics.totalPayment)
    || totals.interest !== roundMoney(economics.overpayment)
    || totals.principal !== roundMoney(economics.amount)
    || balance !== 0) {
    throw new Error("График платежей не согласован с общей выплатой, переплатой или основным долгом");
  }
  return rows;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function documentContentHash(content: string): string {
  return sha256(content);
}

function commonHeader(input: DocumentPackageInput, title: string): string[] {
  return [
    title,
    `Версия документа: ${DOCUMENT_PACKAGE_VERSION}`,
    "ДЕМОНСТРАЦИОННЫЙ ДОКУМЕНТ — НЕ ЯВЛЯЕТСЯ ЮРИДИЧЕСКИ ЗНАЧИМЫМ",
    "",
    `Заявка: ${input.publicNo}`,
    `Заёмщик: ${input.companyName}`,
    `ИНН: ${input.companyInn}`,
    `Представитель: ${input.companyHeadName}`,
    `Продукт: ${input.productName}`,
    `Дата формирования: ${dateLabel(input.generatedAt)}`,
    "",
  ];
}

function contractContent(input: DocumentPackageInput): string {
  const economics = input.economics;
  return [
    ...commonHeader(input, "КРЕДИТНЫЙ ДОГОВОР (ДЕМОНСТРАЦИОННЫЙ МАКЕТ)"),
    "1. ПРЕДМЕТ ДОГОВОРА",
    `Банк моделирует предоставление заёмщику ${money(economics.amount)} ₽ на цель: ${input.purpose}.`,
    `Срок: ${economics.termMonths} мес. Номинальная ставка: ${economics.rate.toLocaleString("ru-RU")}% годовых.`,
    "",
    "2. ПОРЯДОК РАСЧЁТОВ",
    `Тип платежа: аннуитетный. Ориентировочный ежемесячный платёж: ${money(economics.monthlyPayment)} ₽.`,
    `Общая выплата: ${money(economics.totalPayment)} ₽, включая переплату ${money(economics.overpayment)} ₽.`,
    "Комиссии, страхование, штрафы и иные платежи в демонстрации не моделируются и не включены.",
    "Указанная общая выплата не является ПСК или юридической офертой.",
    "",
    "3. УСЛОВИЯ РЕШЕНИЯ",
    `Решение сформировано: ${dateLabel(input.decidedAt)}. Условия действительны до ${dateLabel(economics.validUntil)}.`,
    input.decisionReason ? `Обоснование банка: ${input.decisionReason}` : "Обоснование банка не указано.",
    "",
    "4. ПОДПИСАНИЕ",
    "Подписание в прототипе является модельным: криптографическая электронная подпись, банковская проводка и реальное перечисление средств не выполняются.",
  ].join("\n");
}

function scheduleContent(input: DocumentPackageInput, schedule: PaymentScheduleRow[]): string {
  const rows = schedule.map((row) => [
    row.number,
    dateLabel(row.paymentDate),
    money(row.payment),
    money(row.interest),
    money(row.principal),
    money(row.balance),
  ].join("\t"));
  return [
    ...commonHeader(input, "ГРАФИК ПЛАТЕЖЕЙ"),
    "№\tДата\tПлатёж, ₽\tПроценты, ₽\tОсновной долг, ₽\tОстаток, ₽",
    ...rows,
    "",
    `ИТОГО\t\t${money(input.economics.totalPayment)}\t${money(input.economics.overpayment)}\t${money(input.economics.amount)}\t0,00`,
    "",
    `Контроль: ${schedule.length} платежей; общая выплата и переплата совпадают с финальным решением по заявке ${input.publicNo}.`,
  ].join("\n");
}

function accountStatementContent(input: DocumentPackageInput): string {
  const economics = input.economics;
  return [
    ...commonHeader(input, "СПРАВКА О ПАРАМЕТРАХ МОДЕЛЬНОГО КРЕДИТНОГО СЧЁТА"),
    "Состояние на дату формирования пакета:",
    `Модельный лимит / основной долг: ${money(economics.amount)} ₽.`,
    `Начисленные проценты до начала графика: 0,00 ₽.`,
    `Просроченная задолженность: 0,00 ₽.`,
    `Плановая общая выплата по графику: ${money(economics.totalPayment)} ₽.`,
    `Плановая процентная переплата: ${money(economics.overpayment)} ₽.`,
    "",
    "Справка создана исключительно для демонстрации интерфейса. Реальный банковский счёт не открывался, задолженность и движение денежных средств не создавались.",
  ].join("\n");
}

export function buildDocumentPackage(input: DocumentPackageInput): GeneratedDocument[] {
  const schedule = buildPaymentSchedule(input.economics, input.generatedAt);
  const values: Array<{ kind: RequiredDocumentKind; filename: string; content: string }> = [
    { kind: "Кредитный договор", filename: "Кредитный договор.txt", content: contractContent(input) },
    { kind: "График платежей", filename: "График платежей.txt", content: scheduleContent(input, schedule) },
    { kind: "Справка о состоянии счёта", filename: "Справка о состоянии счёта.txt", content: accountStatementContent(input) },
  ];
  return values.map((document) => ({
    ...document,
    version: DOCUMENT_PACKAGE_VERSION,
    contentHash: sha256(document.content),
  }));
}
