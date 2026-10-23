import { db } from "./db";
import { selectBenefits } from "./benefits";
import { activeFinancialReports } from "./financial-reports";

interface UserRow {
  id: number;
  login: string;
  name: string;
  role: string;
  company_id: number | null;
  position: string | null;
}

interface CompanyRow {
  id: number;
  name: string;
  form: string;
  inn: string;
  ogrn: string;
  okved_code: string;
  okved_name: string;
  reg_date: string;
  address: string;
  head_name: string;
  segment: string;
}


interface CreditHistoryRow {
  bki_score: number;
  active_credits: number;
  total_debt: number;
  overdue_count: number;
  worst_delay_days: number;
  monthly_payment: number;
  updated_at: string;
}

const round = (value: number) => Math.round(value * 10) / 10;

function businessAgeYears(registrationDate: string): number {
  const registeredAt = new Date(registrationDate).getTime();
  return Math.max(0, (Date.now() - registeredAt) / (365.25 * 24 * 60 * 60 * 1000));
}

export function getClientProfile(user: UserRow) {
  if (user.role !== "CLIENT" || user.company_id === null) throw new Error("Профиль доступен только клиенту");

  const company = db.prepare(`
    SELECT id, name, form, inn, ogrn, okved_code, okved_name, reg_date, address, head_name, segment
    FROM companies
    WHERE id = ?
  `).get(user.company_id) as CompanyRow | undefined;
  if (!company) throw new Error("Компания пользователя не найдена");

  const financials = activeFinancialReports(company.id).slice(0, 2);

  const creditHistory = db.prepare(`
    SELECT bki_score, active_credits, total_debt, overdue_count, worst_delay_days, monthly_payment, updated_at
    FROM credit_history
    WHERE company_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(company.id) as CreditHistoryRow | undefined;

  const latest = financials[0] ?? null;
  const previous = financials[1] ?? null;
  const ageYears = businessAgeYears(company.reg_date);
  const marginPercent = latest && latest.revenue > 0 ? round((latest.profit / latest.revenue) * 100) : null;
  const revenueGrowthPercent = latest && previous && previous.revenue > 0
    ? round(((latest.revenue - previous.revenue) / previous.revenue) * 100)
    : null;
  const monthlyIncome = latest ? latest.revenue / 12 : 0;
  const monthlyDebtPayments = (latest?.monthlyObligations ?? 0) + (creditHistory?.monthly_payment ?? 0);
  const pdnPercent = monthlyIncome > 0 ? round((monthlyDebtPayments / monthlyIncome) * 100) : null;

  const benefits = selectBenefits({
    company: {
      form: company.form,
      segment: company.segment,
      okvedCode: company.okved_code,
      ageYears,
    },
    financials: latest ? {
      revenue: latest.revenue,
      profit: latest.profit,
      ownCapital: latest.ownCapital,
    } : null,
    creditHistory: creditHistory ? {
      overdueCount: creditHistory.overdue_count,
      worstDelayDays: creditHistory.worst_delay_days,
    } : null,
  });

  return {
    user: {
      id: user.id,
      login: user.login,
      name: user.name,
      role: user.role,
      company_id: user.company_id,
      position: user.position,
    },
    company,
    financials: financials.map((report) => ({
      id: report.id,
      year: report.year,
      revenue: report.revenue,
      profit: report.profit,
      own_capital: report.ownCapital,
      monthly_obligations: report.monthlyObligations,
      status: report.status,
      source: report.source,
      submitted_at: report.submittedAt,
      verified_at: report.verifiedAt,
    })),
    credit_history: creditHistory ?? null,
    indicators: {
      business_age_years: round(ageYears),
      revenue_growth_percent: revenueGrowthPercent,
      margin_percent: marginPercent,
      pdn_percent: pdnPercent,
    },
    benefits,
    benefits_metadata: {
      mode: "DEMO_DIRECTIONS" as const,
      methodology: "DETERMINISTIC_RULES" as const,
      catalogVersion: "benefits-demo-v1",
      externalDataUsed: false,
      aiUsed: false,
      eligibilityChecked: false,
    },
    benefits_disclaimer: "Подбор носит предварительный информационный характер. Это идеи из демонстрационного каталога, а не подтверждение права на льготу. Актуальные условия и доступность программы необходимо проверить перед обращением.",
  };
}
