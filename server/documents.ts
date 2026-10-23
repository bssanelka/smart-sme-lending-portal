import { db, now } from "./db";
import { requireDecisionEconomicsSnapshot } from "./calculator";
import {
  buildDocumentPackage,
  documentContentHash,
  REQUIRED_DOCUMENT_KINDS,
  type DocumentPackageInput,
} from "./document-templates";

export class DocumentPackageError extends Error {
  override name = "DocumentPackageError";
}

type Row = Record<string, unknown>;

export interface DocumentMetadata {
  id: number;
  application_id: number;
  kind: string;
  filename: string;
  status: string;
  document_version: string | null;
  content_hash: string | null;
  opened_at: string | null;
  opened_by: number | null;
  acknowledged_at: string | null;
  acknowledged_by: number | null;
  signed_at: string | null;
  signed_by: number | null;
  created_at: string;
}

function parseDecision(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw new DocumentPackageError("Финансовый snapshot предложения отсутствует");
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new DocumentPackageError("Финансовый snapshot предложения повреждён");
  }
}

function packageInput(applicationId: number, generatedAt: string): DocumentPackageInput {
  const row = db.prepare(`
    SELECT a.public_no, a.purpose, a.decision, a.decided_at,
      c.name AS company_name, c.inn AS company_inn, c.head_name AS company_head_name,
      p.name AS source_product_name
    FROM applications a
    JOIN companies c ON c.id = a.company_id
    JOIN products p ON p.id = a.product_id
    WHERE a.id = ?
  `).get(applicationId) as Row | undefined;
  if (!row) throw new DocumentPackageError("Заявка для формирования документов не найдена");
  const decision = parseDecision(row.decision);
  let economics;
  try {
    economics = requireDecisionEconomicsSnapshot(decision);
  } catch (error) {
    throw new DocumentPackageError(error instanceof Error ? error.message : "Финансовый snapshot предложения неполон");
  }
  return {
    publicNo: row.public_no as string,
    companyName: row.company_name as string,
    companyInn: row.company_inn as string,
    companyHeadName: row.company_head_name as string,
    productName: typeof decision.productName === "string" ? decision.productName : row.source_product_name as string,
    purpose: row.purpose as string,
    decisionReason: typeof decision.reason === "string" ? decision.reason : null,
    decidedAt: typeof decision.decidedAt === "string" ? decision.decidedAt : row.decided_at as string,
    generatedAt,
    economics,
  };
}

export function generateAndStoreDocumentPackage(applicationId: number): DocumentMetadata[] {
  const generatedAt = now();
  const documents = buildDocumentPackage(packageInput(applicationId, generatedAt));
  const insert = db.prepare(`
    INSERT INTO documents (
      application_id, kind, filename, status, document_version, content_hash, content_text, created_at
    ) VALUES (?, ?, ?, 'GENERATED', ?, ?, ?, ?)
  `);
  for (const document of documents) {
    insert.run(
      applicationId,
      document.kind,
      document.filename,
      document.version,
      document.contentHash,
      document.content,
      generatedAt,
    );
  }
  return listDocumentMetadata(applicationId);
}

export function listDocumentMetadata(applicationId: number): DocumentMetadata[] {
  return db.prepare(`
    SELECT id, application_id, kind, filename, status, document_version, content_hash,
      opened_at, opened_by, acknowledged_at, acknowledged_by, signed_at, signed_by, created_at
    FROM documents
    WHERE application_id = ?
    ORDER BY id
  `).all(applicationId) as DocumentMetadata[];
}

export function downloadableDocument(documentId: number): DocumentMetadata & { content: string } {
  const row = db.prepare(`
    SELECT id, application_id, kind, filename, status, document_version, content_hash, content_text,
      opened_at, opened_by, acknowledged_at, acknowledged_by, signed_at, signed_by, created_at
    FROM documents WHERE id = ?
  `).get(documentId) as (DocumentMetadata & { content_text: string | null }) | undefined;
  if (!row) throw new DocumentPackageError("Документ не найден");
  if (!row.document_version || !row.content_hash || !row.content_text) {
    throw new DocumentPackageError("Документ не содержит серверный snapshot; требуется сформировать пакет заново");
  }
  if (documentContentHash(row.content_text) !== row.content_hash) {
    throw new DocumentPackageError("Контрольная сумма документа не совпадает; скачивание и подписание заблокированы");
  }
  const { content_text: content, ...metadata } = row;
  return { ...metadata, content };
}

export function markDocumentOpened(documentId: number, clientId: number): DocumentMetadata {
  const timestamp = now();
  const result = db.prepare(`
    UPDATE documents
    SET opened_at = COALESCE(opened_at, ?), opened_by = COALESCE(opened_by, ?)
    WHERE id = ? AND status IN ('GENERATED','SIGNED')
  `).run(timestamp, clientId, documentId);
  if (result.changes !== 1) throw new DocumentPackageError("Документ недоступен для ознакомления");
  const document = db.prepare(`
    SELECT id, application_id, kind, filename, status, document_version, content_hash,
      opened_at, opened_by, acknowledged_at, acknowledged_by, signed_at, signed_by, created_at
    FROM documents WHERE id = ?
  `).get(documentId) as DocumentMetadata | undefined;
  if (!document) throw new DocumentPackageError("Документ не найден");
  return document;
}

function assertCompletePackage(applicationId: number, clientId: number, requireAcknowledgement: boolean): DocumentMetadata[] {
  const documents = listDocumentMetadata(applicationId);
  const kinds = new Set(documents.map((document) => document.kind));
  if (documents.length !== REQUIRED_DOCUMENT_KINDS.length
    || REQUIRED_DOCUMENT_KINDS.some((kind) => !kinds.has(kind))) {
    throw new DocumentPackageError("Пакет документов неполон");
  }
  for (const document of documents) {
    if (!document.document_version || !document.content_hash) throw new DocumentPackageError(`Документ «${document.kind}» не имеет версии или hash`);
    downloadableDocument(document.id);
    if (!document.opened_at || document.opened_by !== clientId) {
      throw new DocumentPackageError(`Сначала скачайте документ «${document.kind}» для ознакомления`);
    }
    if (requireAcknowledgement && (!document.acknowledged_at || document.acknowledged_by !== clientId)) {
      throw new DocumentPackageError(`Подтвердите ознакомление с документом «${document.kind}»`);
    }
  }
  return documents;
}

const acknowledgeTransaction = db.transaction((applicationId: number, clientId: number) => {
  const application = db.prepare("SELECT status, client_id FROM applications WHERE id = ?").get(applicationId) as { status: string; client_id: number } | undefined;
  if (!application || application.client_id !== clientId) throw new DocumentPackageError("Нет доступа к пакету документов");
  if (application.status !== "SIGNING") throw new DocumentPackageError("Ознакомление доступно только перед подписанием");
  const documents = assertCompletePackage(applicationId, clientId, false);
  if (documents.every((document) => document.acknowledged_at && document.acknowledged_by === clientId)) {
    return documents.length;
  }
  const timestamp = now();
  db.prepare(`
    UPDATE documents
    SET acknowledged_at = COALESCE(acknowledged_at, ?), acknowledged_by = COALESCE(acknowledged_by, ?)
    WHERE application_id = ?
  `).run(timestamp, clientId, applicationId);
  db.prepare(`
    INSERT INTO application_events (application_id, from_status, to_status, actor, comment, created_at)
    VALUES (?, 'SIGNING', 'SIGNING', 'Клиент', 'Клиент подтвердил ознакомление с полным пакетом документов', ?)
  `).run(applicationId, timestamp);
  return documents.length;
});

export function acknowledgeDocumentPackage(applicationId: number, clientId: number): number {
  return acknowledgeTransaction(applicationId, clientId);
}

export function signAcknowledgedDocumentPackage(applicationId: number, clientId: number): number {
  const documents = assertCompletePackage(applicationId, clientId, true);
  const timestamp = now();
  const result = db.prepare(`
    UPDATE documents
    SET status = 'SIGNED', signed_at = ?, signed_by = ?
    WHERE application_id = ? AND status = 'GENERATED'
  `).run(timestamp, clientId, applicationId);
  if (result.changes !== documents.length) throw new DocumentPackageError("Не удалось подписать полный пакет документов");
  return result.changes;
}

export function assertSignedDocumentPackage(applicationId: number): DocumentMetadata[] {
  const documents = listDocumentMetadata(applicationId);
  const kinds = new Set(documents.map((document) => document.kind));
  if (documents.length !== REQUIRED_DOCUMENT_KINDS.length
    || REQUIRED_DOCUMENT_KINDS.some((kind) => !kinds.has(kind))) {
    throw new DocumentPackageError("Подписанный пакет документов неполон");
  }
  for (const document of documents) {
    downloadableDocument(document.id);
    if (document.status !== "SIGNED" || !document.signed_at || document.signed_by === null) {
      throw new DocumentPackageError(`Документ «${document.kind}» ещё не подписан`);
    }
  }
  return documents;
}
