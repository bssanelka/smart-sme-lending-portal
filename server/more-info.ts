import { db, now } from "./db";

export const MORE_INFO_REQUEST_TYPES = [
  "FINANCIALS",
  "DOCUMENT",
  "COMMENT",
  "BKI_CONSENT",
  "COMPANY_DATA",
  "SYSTEM_RETRY",
] as const;

export type MoreInfoRequestType = typeof MORE_INFO_REQUEST_TYPES[number];
export type MoreInfoRequestStatus = "WAITING_CLIENT" | "CLIENT_RESPONDED" | "RECHECK" | "CLOSED" | "CANCELLED";
export type MoreInfoRequestSource = "SYSTEM" | "BANK";
export type MoreInfoResponseSource = "CLIENT" | "SYSTEM" | "BANK";

export interface MoreInfoRequestInput {
  type: MoreInfoRequestType;
  reason: string;
  requiredFields?: string[];
  requiredFiles?: string[];
  dueAt?: string;
}

export interface MoreInfoResponseSnapshot {
  id: number;
  requestId: number;
  applicationId: number;
  responseType: string;
  payload: Record<string, unknown>;
  source: MoreInfoResponseSource;
  submittedBy: number | null;
  createdAt: string;
}

export interface MoreInfoRequestSnapshot {
  id: number;
  applicationId: number;
  type: MoreInfoRequestType;
  reason: string;
  requiredFields: string[];
  requiredFiles: string[];
  dueAt: string;
  status: MoreInfoRequestStatus;
  source: MoreInfoRequestSource;
  requestedBy: number | null;
  createdAt: string;
  respondedAt: string | null;
  closedAt: string | null;
  response: MoreInfoResponseSnapshot | null;
}

type Row = Record<string, unknown>;

function stringArray(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function responseFromRow(row?: Row): MoreInfoResponseSnapshot | null {
  if (!row) return null;
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.response_json as string);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    id: row.id as number,
    requestId: row.request_id as number,
    applicationId: row.application_id as number,
    responseType: row.response_type as string,
    payload,
    source: row.source as MoreInfoResponseSource,
    submittedBy: row.submitted_by as number | null,
    createdAt: row.created_at as string,
  };
}

function requestFromRow(row: Row): MoreInfoRequestSnapshot {
  const response = db.prepare("SELECT * FROM more_info_responses WHERE request_id = ?").get(row.id as number) as Row | undefined;
  return {
    id: row.id as number,
    applicationId: row.application_id as number,
    type: row.request_type as MoreInfoRequestType,
    reason: row.reason as string,
    requiredFields: stringArray(row.required_fields_json),
    requiredFiles: stringArray(row.required_files_json),
    dueAt: row.due_at as string,
    status: row.status as MoreInfoRequestStatus,
    source: row.source as MoreInfoRequestSource,
    requestedBy: row.requested_by as number | null,
    createdAt: row.created_at as string,
    respondedAt: row.responded_at as string | null,
    closedAt: row.closed_at as string | null,
    response: responseFromRow(response),
  };
}

export function getMoreInfoRequests(applicationId: number): MoreInfoRequestSnapshot[] {
  const rows = db.prepare("SELECT * FROM more_info_requests WHERE application_id = ? ORDER BY id DESC").all(applicationId) as Row[];
  return rows.map(requestFromRow);
}

export function getMoreInfoRequest(requestId: number): MoreInfoRequestSnapshot | null {
  const row = db.prepare("SELECT * FROM more_info_requests WHERE id = ?").get(requestId) as Row | undefined;
  return row ? requestFromRow(row) : null;
}

export function getActiveMoreInfoRequest(applicationId: number): MoreInfoRequestSnapshot | null {
  const row = db.prepare(`
    SELECT * FROM more_info_requests
    WHERE application_id = ? AND status IN ('WAITING_CLIENT','CLIENT_RESPONDED','RECHECK')
    ORDER BY id DESC LIMIT 1
  `).get(applicationId) as Row | undefined;
  return row ? requestFromRow(row) : null;
}

function normalizedList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function createMoreInfoRequest(
  applicationId: number,
  input: MoreInfoRequestInput,
  source: MoreInfoRequestSource,
  requestedBy: number | null,
): MoreInfoRequestSnapshot {
  const createdAt = now();
  const dueAt = input.dueAt ? new Date(input.dueAt) : new Date(createdAt);
  if (!input.dueAt) dueAt.setUTCDate(dueAt.getUTCDate() + (input.type === "SYSTEM_RETRY" ? 2 : 5));
  if (!Number.isFinite(dueAt.getTime())) throw new Error("Срок ответа указан некорректно");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("Укажите причину запроса");

  db.prepare(`
    UPDATE more_info_requests
    SET status = CASE WHEN status = 'RECHECK' THEN 'CLOSED' ELSE 'CANCELLED' END, closed_at = ?
    WHERE application_id = ? AND status IN ('WAITING_CLIENT','CLIENT_RESPONDED','RECHECK')
  `).run(createdAt, applicationId);

  const id = Number(db.prepare(`
    INSERT INTO more_info_requests (
      application_id, request_type, reason, required_fields_json, required_files_json,
      due_at, status, source, requested_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    applicationId,
    input.type,
    reason,
    JSON.stringify(normalizedList(input.requiredFields)),
    JSON.stringify(normalizedList(input.requiredFiles)),
    dueAt.toISOString(),
    input.type === "SYSTEM_RETRY" ? "RECHECK" : "WAITING_CLIENT",
    source,
    requestedBy,
    createdAt,
  ).lastInsertRowid);

  db.prepare(`
    UPDATE recommendation_snapshots
    SET superseded_at = ?, superseded_by_request_id = ?
    WHERE id = (
      SELECT id FROM recommendation_snapshots
      WHERE application_id = ? AND superseded_at IS NULL
      ORDER BY id DESC LIMIT 1
    )
  `).run(createdAt, id, applicationId);

  return getMoreInfoRequest(id)!;
}

export function cancelActiveMoreInfoRequests(applicationId: number) {
  db.prepare(`
    UPDATE more_info_requests
    SET status = 'CANCELLED', closed_at = ?
    WHERE application_id = ? AND status IN ('WAITING_CLIENT','CLIENT_RESPONDED','RECHECK')
  `).run(now(), applicationId);
}

export function saveMoreInfoResponse(
  requestId: number,
  payload: Record<string, unknown>,
  source: MoreInfoResponseSource,
  submittedBy: number | null,
): MoreInfoResponseSnapshot {
  const request = getMoreInfoRequest(requestId);
  if (!request) throw new Error("Запрос дополнительной информации не найден");
  if (request.status !== "WAITING_CLIENT" && !(request.type === "SYSTEM_RETRY" && request.status === "RECHECK")) {
    throw new Error("Запрос уже обработан или закрыт");
  }
  const createdAt = now();
  const id = Number(db.prepare(`
    INSERT INTO more_info_responses (
      request_id, application_id, response_type, response_json, source, submitted_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(requestId, request.applicationId, request.type, JSON.stringify(payload), source, submittedBy, createdAt).lastInsertRowid);
  db.prepare("UPDATE more_info_requests SET status = 'CLIENT_RESPONDED', responded_at = ? WHERE id = ?")
    .run(createdAt, requestId);
  return responseFromRow(db.prepare("SELECT * FROM more_info_responses WHERE id = ?").get(id) as Row)!;
}

export function markMoreInfoRecheck(requestId: number) {
  db.prepare("UPDATE more_info_requests SET status = 'RECHECK' WHERE id = ? AND status = 'CLIENT_RESPONDED'").run(requestId);
}

export function closeMoreInfoRequest(requestId: number) {
  db.prepare("UPDATE more_info_requests SET status = 'CLOSED', closed_at = ? WHERE id = ? AND status = 'RECHECK'")
    .run(now(), requestId);
}
