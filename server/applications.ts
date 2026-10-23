import { addEvent, publicNo, runConveyor } from "./conveyor";
import { db, now } from "./db";

export interface ApplicationOwner {
  id: number;
  company_id: number;
  name: string;
}

export interface NewApplication {
  product_id: number;
  amount: number;
  term_months: number;
  purpose: string;
  purpose_category: string;
  calculation_id: number;
}

export interface CreatedApplication {
  id: number;
  public_no: string;
  created: boolean;
}

type ExistingApplication = {
  id: number;
  public_no: string;
  client_id: number;
  company_id: number;
  status: string;
};

export function findApplicationByCalculation(calculationId: number): ExistingApplication | undefined {
  return db.prepare(`
    SELECT id, public_no, client_id, company_id, status
    FROM applications
    WHERE source_calculation_id = ?
  `).get(calculationId) as ExistingApplication | undefined;
}

const createApplicationTransaction = db.transaction((user: ApplicationOwner, input: NewApplication): CreatedApplication => {
  const existing = findApplicationByCalculation(input.calculation_id);
  if (existing) {
    if (existing.client_id !== user.id || existing.company_id !== user.company_id) {
      throw new Error("Сохранённый расчёт уже использован другой заявкой");
    }
    return { id: existing.id, public_no: existing.public_no, created: false };
  }

  const createdAt = now();
  const id = Number(db.prepare(`
    INSERT INTO applications (
      public_no, client_id, company_id, product_id, amount, term_months,
      purpose, purpose_category, source_calculation_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)
  `).run(
    "TMP",
    user.id,
    user.company_id,
    input.product_id,
    input.amount,
    input.term_months,
    input.purpose,
    input.purpose_category,
    input.calculation_id,
    createdAt,
    createdAt,
  ).lastInsertRowid);
  const applicationPublicNo = publicNo(id);
  db.prepare("UPDATE applications SET public_no = ? WHERE id = ?").run(applicationPublicNo, id);
  addEvent(id, null, "SUBMITTED", user.name, "Заявка подана через личный кабинет");
  runConveyor(id);

  return { id, public_no: applicationPublicNo, created: true };
});

export function createApplicationFromCalculation(user: ApplicationOwner, input: NewApplication): CreatedApplication {
  try {
    return createApplicationTransaction(user, input);
  } catch (error) {
    // A unique index is the final guard if another process consumes the same
    // calculation between the lookup and INSERT.
    const existing = findApplicationByCalculation(input.calculation_id);
    if (existing && existing.client_id === user.id && existing.company_id === user.company_id) {
      return { id: existing.id, public_no: existing.public_no, created: false };
    }
    throw error;
  }
}
