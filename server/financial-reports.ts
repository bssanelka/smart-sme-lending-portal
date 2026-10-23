import { db, now } from "./db";

export const FINANCIAL_REPORT_STATUSES = ["SUBMITTED", "VERIFIED", "REJECTED"] as const;
export const FINANCIAL_REPORT_SOURCES = ["CLIENT", "BANK", "DEMO_SEED", "LEGACY"] as const;

export type FinancialReportStatus = typeof FINANCIAL_REPORT_STATUSES[number];
export type FinancialReportSource = typeof FINANCIAL_REPORT_SOURCES[number];

export interface FinancialReportInput {
  year: number;
  revenue: number;
  profit: number;
  ownCapital: number;
  monthlyObligations: number;
  comment?: string;
}

export interface FinancialReportSnapshot {
  id: number;
  companyId: number;
  applicationId: number | null;
  year: number;
  revenue: number;
  profit: number;
  ownCapital: number;
  monthlyObligations: number;
  status: FinancialReportStatus;
  source: FinancialReportSource;
  submittedBy: number | null;
  verifiedBy: number | null;
  submittedAt: string;
  verifiedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

type FinancialReportRow = {
  id: number;
  company_id: number;
  application_id: number | null;
  reporting_year: number;
  revenue: number;
  profit: number;
  own_capital: number;
  monthly_obligations: number;
  status: FinancialReportStatus;
  source: FinancialReportSource;
  submitted_by: number | null;
  verified_by: number | null;
  submitted_at: string;
  verified_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
};

function snapshot(row: FinancialReportRow): FinancialReportSnapshot {
  return {
    id: row.id,
    companyId: row.company_id,
    applicationId: row.application_id,
    year: row.reporting_year,
    revenue: row.revenue,
    profit: row.profit,
    ownCapital: row.own_capital,
    monthlyObligations: row.monthly_obligations,
    status: row.status,
    source: row.source,
    submittedBy: row.submitted_by,
    verifiedBy: row.verified_by,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
  };
}

export function allowedFinancialReportYears(referenceDate = new Date()): [number, number] {
  const currentYear = referenceDate.getUTCFullYear();
  return [currentYear - 1, currentYear];
}

export function validateFinancialReport(input: FinancialReportInput, referenceDate = new Date()): void {
  const [minimumYear, maximumYear] = allowedFinancialReportYears(referenceDate);
  if (!Number.isInteger(input.year) || input.year < minimumYear || input.year > maximumYear) {
    throw new Error(`Допустимы отчётные периоды ${minimumYear} и ${maximumYear} годов`);
  }
  const values = [input.revenue, input.profit, input.ownCapital, input.monthlyObligations];
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Финансовые показатели должны быть конечными числами");
  if (input.revenue < 0) throw new Error("Выручка не может быть отрицательной");
  if (input.ownCapital < 0) throw new Error("Собственный капитал не может быть отрицательным");
  if (input.monthlyObligations < 0) throw new Error("Ежемесячные обязательства не могут быть отрицательными");
  if (input.profit > input.revenue) throw new Error("Прибыль не может превышать выручку за тот же период");
  if (input.revenue === 0 && input.profit !== 0) throw new Error("При нулевой выручке прибыль должна быть равна нулю");
}

export function submitClientFinancialReport(
  companyId: number,
  applicationId: number,
  clientId: number,
  input: FinancialReportInput,
): FinancialReportSnapshot {
  validateFinancialReport(input);
  const existing = db.prepare(`
    SELECT status FROM financial_reports
    WHERE company_id = ? AND reporting_year = ? AND status IN ('SUBMITTED','VERIFIED')
    LIMIT 1
  `).get(companyId, input.year) as { status: FinancialReportStatus } | undefined;
  if (existing?.status === "VERIFIED") throw new Error("Отчётность за этот период уже подтверждена банком");
  if (existing) throw new Error("Отчётность за этот период уже передана и ожидает проверки банка");

  const submittedAt = now();
  const id = Number(db.prepare(`
    INSERT INTO financial_reports (
      company_id, application_id, reporting_year, revenue, profit, own_capital,
      monthly_obligations, status, source, submitted_by, submitted_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 'CLIENT', ?, ?, ?)
  `).run(
    companyId,
    applicationId,
    input.year,
    input.revenue,
    input.profit,
    input.ownCapital,
    input.monthlyObligations,
    clientId,
    submittedAt,
    submittedAt,
  ).lastInsertRowid);
  return getFinancialReport(id)!;
}

export function getFinancialReport(id: number): FinancialReportSnapshot | null {
  const row = db.prepare("SELECT * FROM financial_reports WHERE id = ?").get(id) as FinancialReportRow | undefined;
  return row ? snapshot(row) : null;
}

export function listFinancialReports(companyId: number): FinancialReportSnapshot[] {
  const rows = db.prepare(`
    SELECT * FROM financial_reports
    WHERE company_id = ?
    ORDER BY reporting_year DESC, id DESC
  `).all(companyId) as FinancialReportRow[];
  return rows.map(snapshot);
}

export function activeFinancialReports(companyId: number): FinancialReportSnapshot[] {
  const [, maximumYear] = allowedFinancialReportYears();
  const minimumHistoryYear = maximumYear - 2;
  const rows = db.prepare(`
    SELECT * FROM financial_reports
    WHERE company_id = ?
      AND status IN ('SUBMITTED','VERIFIED')
      AND reporting_year BETWEEN ? AND ?
    ORDER BY reporting_year DESC, CASE status WHEN 'VERIFIED' THEN 0 ELSE 1 END, id DESC
  `).all(companyId, minimumHistoryYear, maximumYear) as FinancialReportRow[];
  const years = new Set<number>();
  const reports: FinancialReportSnapshot[] = [];
  for (const row of rows) {
    if (years.has(row.reporting_year)) continue;
    years.add(row.reporting_year);
    reports.push(snapshot(row));
  }
  return reports;
}

export function financialReportForScoring(companyId: number, applicationId?: number): FinancialReportSnapshot | null {
  const [minimumYear] = allowedFinancialReportYears();
  const rows = activeFinancialReports(companyId).filter((report) => report.year >= minimumYear);
  if (rows.length === 0) return null;
  if (applicationId !== undefined) {
    const applicationReport = rows.find((report) => report.applicationId === applicationId);
    if (applicationReport) return applicationReport;
  }
  return rows[0];
}

export function verifyFinancialReport(reportId: number, bankUserId: number): FinancialReportSnapshot {
  const report = getFinancialReport(reportId);
  if (!report) throw new Error("Финансовая отчётность не найдена");
  if (report.status === "REJECTED") throw new Error("Отклонённую отчётность нельзя подтвердить");
  if (report.status === "VERIFIED") return report;
  const verifiedAt = now();
  db.prepare(`
    UPDATE financial_reports
    SET status = 'VERIFIED', verified_by = ?, verified_at = ?, rejected_at = NULL, rejection_reason = NULL
    WHERE id = ? AND status = 'SUBMITTED'
  `).run(bankUserId, verifiedAt, reportId);
  return getFinancialReport(reportId)!;
}

export function rejectFinancialReport(reportId: number, bankUserId: number, reason: string): FinancialReportSnapshot {
  const report = getFinancialReport(reportId);
  if (!report) throw new Error("Финансовая отчётность не найдена");
  if (report.status !== "SUBMITTED") throw new Error("Отклонить можно только отчётность, ожидающую проверки");
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3) throw new Error("Укажите причину отклонения отчётности");
  const rejectedAt = now();
  db.prepare(`
    UPDATE financial_reports
    SET status = 'REJECTED', verified_by = ?, verified_at = NULL, rejected_at = ?, rejection_reason = ?
    WHERE id = ? AND status = 'SUBMITTED'
  `).run(bankUserId, rejectedAt, normalizedReason, reportId);
  return getFinancialReport(reportId)!;
}
