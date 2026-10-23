import { db, now } from "./db";

export type ExternalCheckKind = "BKI" | "BUSINESS_REGISTRY";
export type ExternalCheckStatus = "SUCCESS" | "NOT_FOUND" | "ERROR";

export interface CreditHistorySnapshot {
  id: number;
  company_id: number;
  bki_score: number;
  active_credits: number;
  total_debt: number;
  overdue_count: number;
  worst_delay_days: number;
  monthly_payment: number;
  updated_at: string;
}

export interface BusinessRegistrySnapshot {
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

export interface ProviderResult<T> {
  kind: ExternalCheckKind;
  provider: string;
  providerVersion: string;
  status: ExternalCheckStatus;
  subjectKey: string;
  payload: T | null;
  requestedAt: string;
}

export interface CreditBureauProvider {
  checkByCompanyId(companyId: number): ProviderResult<CreditHistorySnapshot>;
  checkByInn(inn: string): ProviderResult<CreditHistorySnapshot>;
}

export interface BusinessRegistryProvider {
  checkByCompanyId(companyId: number): ProviderResult<BusinessRegistrySnapshot>;
  checkByInn(inn: string): ProviderResult<BusinessRegistrySnapshot>;
}

const BKI_PROVIDER = "local-synthetic-bki";
const BKI_PROVIDER_VERSION = "v1";
const REGISTRY_PROVIDER = "local-synthetic-egrul-egrip";
const REGISTRY_PROVIDER_VERSION = "v1";

type CompanyIdentity = { id: number; inn: string };

function companyIdentityById(companyId: number): CompanyIdentity | undefined {
  return db.prepare("SELECT id, inn FROM companies WHERE id = ?").get(companyId) as CompanyIdentity | undefined;
}

function companyIdentityByInn(inn: string): CompanyIdentity | undefined {
  return db.prepare("SELECT id, inn FROM companies WHERE inn = ?").get(inn) as CompanyIdentity | undefined;
}

function bkiResult(identity: CompanyIdentity | undefined, subjectKey: string): ProviderResult<CreditHistorySnapshot> {
  const requestedAt = now();
  if (!identity) {
    return {
      kind: "BKI",
      provider: BKI_PROVIDER,
      providerVersion: BKI_PROVIDER_VERSION,
      status: "NOT_FOUND",
      subjectKey,
      payload: null,
      requestedAt,
    };
  }
  const payload = db.prepare(`
    SELECT id, company_id, bki_score, active_credits, total_debt, overdue_count,
      worst_delay_days, monthly_payment, updated_at
    FROM credit_history
    WHERE company_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(identity.id) as CreditHistorySnapshot | undefined;
  return {
    kind: "BKI",
    provider: BKI_PROVIDER,
    providerVersion: BKI_PROVIDER_VERSION,
    status: payload ? "SUCCESS" : "NOT_FOUND",
    subjectKey: identity.inn,
    payload: payload ?? null,
    requestedAt,
  };
}

function registryResult(identity: CompanyIdentity | undefined, subjectKey: string): ProviderResult<BusinessRegistrySnapshot> {
  const requestedAt = now();
  const payload = identity
    ? db.prepare(`
        SELECT id, name, form, inn, ogrn, okved_code, okved_name, reg_date,
          address, head_name, segment
        FROM companies
        WHERE id = ?
      `).get(identity.id) as BusinessRegistrySnapshot | undefined
    : undefined;
  return {
    kind: "BUSINESS_REGISTRY",
    provider: REGISTRY_PROVIDER,
    providerVersion: REGISTRY_PROVIDER_VERSION,
    status: payload ? "SUCCESS" : "NOT_FOUND",
    subjectKey: identity?.inn ?? subjectKey,
    payload: payload ?? null,
    requestedAt,
  };
}

export const localCreditBureauProvider: CreditBureauProvider = {
  checkByCompanyId: (companyId) => bkiResult(companyIdentityById(companyId), String(companyId)),
  checkByInn: (inn) => bkiResult(companyIdentityByInn(inn), inn),
};

export const localBusinessRegistryProvider: BusinessRegistryProvider = {
  checkByCompanyId: (companyId) => registryResult(companyIdentityById(companyId), String(companyId)),
  checkByInn: (inn) => registryResult(companyIdentityByInn(inn), inn),
};

export interface StoredExternalCheck<T = unknown> {
  id: number;
  application_id: number;
  kind: ExternalCheckKind;
  provider: string;
  provider_version: string;
  status: ExternalCheckStatus;
  subject_key: string;
  payload: T | null;
  requested_at: string;
}

function storeResult<T>(applicationId: number, result: ProviderResult<T>): StoredExternalCheck<T> {
  const id = Number(db.prepare(`
    INSERT INTO external_check_snapshots (
      application_id, kind, provider, provider_version, status,
      subject_key, payload_json, requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    applicationId,
    result.kind,
    result.provider,
    result.providerVersion,
    result.status,
    result.subjectKey,
    result.payload === null ? null : JSON.stringify(result.payload),
    result.requestedAt,
  ).lastInsertRowid);
  return {
    id,
    application_id: applicationId,
    kind: result.kind,
    provider: result.provider,
    provider_version: result.providerVersion,
    status: result.status,
    subject_key: result.subjectKey,
    payload: result.payload,
    requested_at: result.requestedAt,
  };
}

export function captureExternalCheckSnapshots(applicationId: number, companyId: number) {
  return {
    registry: storeResult(applicationId, localBusinessRegistryProvider.checkByCompanyId(companyId)),
    bki: storeResult(applicationId, localCreditBureauProvider.checkByCompanyId(companyId)),
  };
}

export function latestExternalCheck<T>(applicationId: number, kind: ExternalCheckKind): StoredExternalCheck<T> | null {
  const row = db.prepare(`
    SELECT id, application_id, kind, provider, provider_version, status,
      subject_key, payload_json, requested_at
    FROM external_check_snapshots
    WHERE application_id = ? AND kind = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(applicationId, kind) as (Omit<StoredExternalCheck<T>, "payload"> & { payload_json: string | null }) | undefined;
  if (!row) return null;

  let payload: T | null = null;
  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json) as T;
    } catch {
      payload = null;
    }
  }
  const { payload_json: _payloadJson, ...metadata } = row;
  void _payloadJson;
  return { ...metadata, payload };
}

export function getApplicationExternalChecks(applicationId: number) {
  return {
    registry: latestExternalCheck<BusinessRegistrySnapshot>(applicationId, "BUSINESS_REGISTRY"),
    bki: latestExternalCheck<CreditHistorySnapshot>(applicationId, "BKI"),
  };
}

export function backfillExternalCheckSnapshots(): number {
  const applications = db.prepare("SELECT id, company_id FROM applications ORDER BY id").all() as Array<{ id: number; company_id: number }>;
  let inserted = 0;
  const backfill = db.transaction(() => {
    for (const application of applications) {
      if (!latestExternalCheck(application.id, "BUSINESS_REGISTRY")) {
        storeResult(application.id, localBusinessRegistryProvider.checkByCompanyId(application.company_id));
        inserted += 1;
      }
      if (!latestExternalCheck(application.id, "BKI")) {
        storeResult(application.id, localCreditBureauProvider.checkByCompanyId(application.company_id));
        inserted += 1;
      }
    }
  });
  backfill();
  return inserted;
}
