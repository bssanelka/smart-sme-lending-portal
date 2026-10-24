import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDecisionEconomics } from "../server/calculator";

let app: typeof import("../server/app")["app"];
let database: typeof import("../server/db")["db"];
let dataDir: string;

type Row = Record<string, unknown>;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "alfa-http-rbac-"));
  process.env.DATA_DIR = dataDir;
  ({ app } = await import("../server/app"));
  ({ db: database } = await import("../server/db"));
});

afterAll(() => {
  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function login(loginName: string): Promise<string> {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: loginName, password: "demo123" }),
  });
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";", 1)[0];
}

function authenticatedRequest(pathname: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return app.request(pathname, { ...init, headers });
}

function user(loginName: string): Row {
  return database.prepare("SELECT * FROM users WHERE login = ?").get(loginName) as Row;
}

function createApplication(status: string, loginName = "client1"): number {
  const owner = user(loginName);
  const product = database.prepare("SELECT * FROM products ORDER BY id LIMIT 1").get() as Row;
  const timestamp = new Date().toISOString();
  return Number(database.prepare(`
    INSERT INTO applications (
      public_no, client_id, company_id, product_id, amount, term_months,
      purpose, purpose_category, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1000000, 12, 'HTTP test purpose', 'оборотные средства', ?, ?, ?)
  `).run(`HTTP-${status}-${crypto.randomUUID()}`, owner.id, owner.company_id, product.id, status, timestamp, timestamp).lastInsertRowid);
}

function createOffer(loginName = "client1", validUntil = new Date(Date.now() + 86_400_000).toISOString()): number {
  const applicationId = createApplication("OFFER", loginName);
  const appRow = database.prepare("SELECT * FROM applications WHERE id = ?").get(applicationId) as Row;
  const product = database.prepare("SELECT * FROM products WHERE id = ?").get(appRow.product_id) as Row;
  const decidedAt = new Date().toISOString();
  const decision = {
    type: "APPROVE",
    productId: product.id,
    productName: product.name,
    rate: product.rate_from,
    amount: appRow.amount,
    termMonths: appRow.term_months,
    reason: "Тестовое предложение",
    decidedAt,
    ...buildDecisionEconomics(Number(appRow.amount), Number(product.rate_from), Number(appRow.term_months), decidedAt),
    validUntil,
  };
  database.prepare("UPDATE applications SET decision = ?, decided_at = ? WHERE id = ?")
    .run(JSON.stringify(decision), decision.decidedAt, applicationId);
  return applicationId;
}

function createMoreInfoApplication(requestType: "SYSTEM_RETRY" | "COMMENT", requestStatus: "RECHECK" | "WAITING_CLIENT" | "CLOSED") {
  const applicationId = createApplication("MORE_INFO");
  const timestamp = new Date().toISOString();
  const requestId = Number(database.prepare(`
    INSERT INTO more_info_requests (
      application_id, request_type, reason, required_fields_json, required_files_json,
      due_at, status, source, requested_by, created_at
    ) VALUES (?, ?, 'HTTP retry test', '[]', '[]', ?, ?, 'BANK', ?, ?)
  `).run(
    applicationId,
    requestType,
    new Date(Date.now() + 86_400_000).toISOString(),
    requestStatus,
    user("bank").id,
    timestamp,
  ).lastInsertRowid);
  return { applicationId, requestId };
}

describe("HTTP authentication, RBAC and command boundaries", () => {
  it("rejects anonymous access with the common 401 envelope", async () => {
    const response = await app.request("/api/applications/mine");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: expect.any(String) });
  });

  it("restricts benefit preview to clients and validates the request strictly", async () => {
    const clientCookie = await login("client1");
    const bankCookie = await login("bank");
    const body = {
      region: "Москва",
      sme_status: "micro",
      purpose: "investment",
      amount: 2_000_000,
      term_months: 24,
      industry: "56.10 · Деятельность ресторанов и услуги по доставке продуктов питания",
    };
    const request = (cookie?: string, requestBody: Record<string, unknown> = body) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cookie) headers.Cookie = cookie;
      return app.request("/api/client/profile/benefits/preview", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
    };

    expect((await request()).status).toBe(401);
    expect((await request(bankCookie)).status).toBe(403);

    const response = await request(clientCookie);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      data: { items: Array<Record<string, unknown>>; metadata: Record<string, unknown> };
    };
    expect(payload.data.metadata).toEqual({
      eligibilityChecked: false,
      externalDataUsed: false,
      answersPersisted: false,
    });
    expect(payload.data.items.length).toBeGreaterThan(0);
    expect(payload.data.items[0]).toEqual(expect.objectContaining({
      item: expect.any(Object),
      reasons: expect.any(Array),
      unknowns: expect.any(Array),
    }));
    expect(payload.data.items[0]).not.toHaveProperty("score");

    const invalid = await request(clientCookie, { ...body, unexpected: true });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: expect.any(String) });
  });

  it("returns server-calculated economics for every eligible product option", async () => {
    const clientCookie = await login("client1");
    const response = await authenticatedRequest("/api/calculator/evaluate", clientCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1_500_000, term_months: 12, purpose_category: "оборотные средства" }),
    });
    const payload = await response.json() as {
      data: {
        selection: {
          recommended: { economics: Record<string, unknown> };
          alternatives: Array<{ economics: Record<string, unknown> }>;
        };
      };
    };

    expect(response.status).toBe(200);
    const options = [payload.data.selection.recommended, ...payload.data.selection.alternatives];
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) {
      expect(option.economics).toEqual(expect.objectContaining({
        compatibilityIndex: expect.any(Number),
        compatibilityLevel: expect.stringMatching(/^(HIGH|MEDIUM|MANUAL_REVIEW)$/),
        rate: expect.any(Number),
        monthlyPayment: expect.any(Number),
        overpayment: expect.any(Number),
        totalPayment: expect.any(Number),
      }));
      expect(option.economics).not.toHaveProperty("approvalChance");
    }
  });

  it("prevents a client from reading another client's application and document", async () => {
    const client2Cookie = await login("client2");
    const client1 = user("client1");
    const foreignApplication = database.prepare("SELECT id FROM applications WHERE client_id = ? ORDER BY id LIMIT 1").get(client1.id) as { id: number };
    const foreignDocument = database.prepare(`
      SELECT d.id FROM documents d
      JOIN applications a ON a.id = d.application_id
      WHERE a.client_id = ? ORDER BY d.id LIMIT 1
    `).get(client1.id) as { id: number };

    const applicationResponse = await authenticatedRequest(`/api/applications/${foreignApplication.id}`, client2Cookie);
    const documentResponse = await authenticatedRequest(`/api/documents/${foreignDocument.id}/download`, client2Cookie);

    expect(applicationResponse.status).toBe(403);
    expect(documentResponse.status).toBe(403);
  });

  it("prevents clients from bank endpoints and bank users from client mutations", async () => {
    const clientCookie = await login("client1");
    const bankCookie = await login("bank");
    const client1 = user("client1");
    const clientApplication = database.prepare("SELECT id FROM applications WHERE client_id = ? ORDER BY id LIMIT 1").get(client1.id) as { id: number };

    const bankEndpoint = await authenticatedRequest("/api/bank/queue", clientCookie);
    const clientMutation = await authenticatedRequest(`/api/applications/${clientApplication.id}/accept`, bankCookie, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });

    expect(bankEndpoint.status).toBe(403);
    expect(clientMutation.status).toBe(403);
  });

  it("keeps the template assistant private to the client owner", async () => {
    const client1Cookie = await login("client1");
    const client2Cookie = await login("client2");
    const bankCookie = await login("bank");
    const applicationId = createApplication("DECISION", "client1");
    const ask = (cookie: string, message: string) => authenticatedRequest("/api/assistant", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: applicationId, message }),
    });

    const ownerResponse = await ask(client1Cookie, "Какие документы нужны?");
    expect(ownerResponse.status).toBe(200);
    expect(await ownerResponse.json()).toEqual({
      ok: true,
      data: { text: expect.any(String), source: "template" },
    });
    expect((database.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE application_id = ?").get(applicationId) as { count: number }).count).toBe(2);

    expect((await ask(client2Cookie, "Покажи статус заявки")).status).toBe(403);
    expect((await ask(bankCookie, "Покажи переписку клиента")).status).toBe(403);
    expect((database.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE application_id = ?").get(applicationId) as { count: number }).count).toBe(2);

    const bankApplication = await authenticatedRequest(`/api/applications/${applicationId}`, bankCookie);
    expect(bankApplication.status).toBe(200);
    expect((await bankApplication.json() as { data: { chat: unknown[] } }).data.chat).toEqual([]);
  });

  it("limits template assistant message length", async () => {
    const clientCookie = await login("client1");
    const response = await authenticatedRequest("/api/assistant", clientCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "а".repeat(1001) }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 409 for an invalid state transition", async () => {
    const clientCookie = await login("client1");
    const applicationId = createApplication("ISSUED");
    const response = await authenticatedRequest(`/api/applications/${applicationId}/accept`, clientCookie, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects an expired offer without changing its status", async () => {
    const clientCookie = await login("client1");
    const applicationId = createOffer("client1", new Date(Date.now() - 60_000).toISOString());
    const response = await authenticatedRequest(`/api/applications/${applicationId}/accept`, clientCookie, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });

    expect(response.status).toBe(409);
    expect(database.prepare("SELECT status FROM applications WHERE id = ?").get(applicationId)).toEqual({ status: "OFFER" });
  });

  it("replays a successful command without a duplicate side effect", async () => {
    const clientCookie = await login("client1");
    const applicationId = createOffer();
    const key = crypto.randomUUID();
    const request = () => authenticatedRequest(`/api/applications/${applicationId}/accept`, clientCookie, {
      method: "POST",
      headers: { "Idempotency-Key": key },
    });

    const first = await request();
    const firstPayload = await first.json();
    const eventCount = database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(applicationId);
    const replay = await request();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstPayload);
    expect(database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(applicationId)).toEqual(eventCount);
  });

  it("replays a bank decision before the new status check", async () => {
    const bankCookie = await login("bank");
    const applicationId = createApplication("DECISION");
    const key = crypto.randomUUID();
    const request = () => authenticatedRequest(`/api/bank/applications/${applicationId}/decision`, bankCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        type: "REJECT",
        internal_reason: "Внутренняя оценка денежного потока не соответствует риск-политике",
        client_comment: "Не можем одобрить заявку из-за недостаточной устойчивости денежного потока",
      }),
    });

    const first = await request();
    const replay = await request();

    expect(first.status).toBe(200);
    expect(database.prepare("SELECT status FROM applications WHERE id = ?").get(applicationId)).toEqual({ status: "REJECTED" });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
  });

  it.each([
    ["offer without internal_reason", {
      type: "APPROVE", rate: 20, amount: 1_000_000, term_months: 12,
      client_comment: "Кредит одобрен на запрошенных условиях",
    }],
    ["offer without client_comment", {
      type: "APPROVE", rate: 20, amount: 1_000_000, term_months: 12,
      internal_reason: "Риск-профиль соответствует политике банка",
    }],
    ["reject without internal_reason", {
      type: "REJECT", client_comment: "Банк не может одобрить заявку",
    }],
    ["reject without client_comment", {
      type: "REJECT", internal_reason: "Риск-профиль не соответствует политике банка",
    }],
  ])("validates separated decision text fields for %s", async (_caseName, body) => {
    const bankCookie = await login("bank");
    const applicationId = createApplication("DECISION");
    const response = await authenticatedRequest(`/api/bank/applications/${applicationId}/decision`, bankCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    expect(database.prepare("SELECT status, decision FROM applications WHERE id = ?").get(applicationId))
      .toEqual({ status: "DECISION", decision: null });
  });

  it("accepts and replays the deprecated single-reason decision contract without leaking it as internal rationale", async () => {
    const bankCookie = await login("bank");
    const clientCookie = await login("client1");
    const applicationId = createApplication("DECISION");
    const key = crypto.randomUUID();
    const legacyReason = "Банк не может одобрить заявку по результатам проверки предоставленных данных";
    const request = () => authenticatedRequest(`/api/bank/applications/${applicationId}/decision`, bankCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ type: "REJECT", reason: legacyReason }),
    });

    const first = await request();
    const replay = await request();
    const bankPayload = await first.json() as { data: { decision: Record<string, unknown> } };
    const clientResponse = await authenticatedRequest(`/api/applications/${applicationId}`, clientCookie);
    const clientPayload = await clientResponse.json() as { data: { decision: Record<string, unknown> } };

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(bankPayload.data.decision).toMatchObject({
      reason: legacyReason,
      clientComment: legacyReason,
      internalReason: expect.stringContaining("устаревший API-контракт"),
    });
    expect(clientPayload.data.decision).toMatchObject({ reason: legacyReason, clientComment: legacyReason });
    expect(clientPayload.data.decision).not.toHaveProperty("internalReason");
  });

  it("keeps internal rationale bank-only and exposes the client comment through both public aliases", async () => {
    const bankCookie = await login("bank");
    const clientCookie = await login("client1");
    const applicationId = createApplication("DECISION");
    const internalReason = "Внутренний триггер AML-RISK-42 требует отказа";
    const clientComment = "Банк не может одобрить заявку по результатам комплексной оценки";
    const response = await authenticatedRequest(`/api/bank/applications/${applicationId}/decision`, bankCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ type: "REJECT", internal_reason: internalReason, client_comment: clientComment }),
    });
    const bankPayload = await response.json() as { data: { decision: Record<string, unknown> } };

    expect(response.status).toBe(200);
    expect(bankPayload.data.decision).toMatchObject({
      internalReason,
      clientComment,
      reason: clientComment,
    });

    const clientResponse = await authenticatedRequest(`/api/applications/${applicationId}`, clientCookie);
    const clientPayload = await clientResponse.json() as { data: { decision: Record<string, unknown>; events: Array<{ comment: string | null }> } };
    const serialized = JSON.stringify(clientPayload);

    expect(clientResponse.status).toBe(200);
    expect(clientPayload.data.decision).toMatchObject({ clientComment, reason: clientComment });
    expect(clientPayload.data.decision).not.toHaveProperty("internalReason");
    expect(clientPayload.data.events.at(-1)?.comment).toBe(clientComment);
    expect(serialized).not.toContain(internalReason);
  });

  it("keeps a persisted legacy decision reason out of the client projection", async () => {
    const clientCookie = await login("client1");
    const applicationId = createOffer();
    database.prepare(`
      INSERT INTO application_events (application_id, from_status, to_status, actor, comment, created_at)
      VALUES (?, 'DECISION', 'OFFER', 'Legacy bank', 'Тестовое предложение', ?)
    `).run(applicationId, new Date().toISOString());
    const response = await authenticatedRequest(`/api/applications/${applicationId}`, clientCookie);
    const payload = await response.json() as { data: { decision: Record<string, unknown>; events: Array<{ comment: string | null }> } };
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.data.decision).toMatchObject({
      reason: "Банк одобрил заявку на предложенных условиях после проверки предоставленных данных.",
      clientComment: "Банк одобрил заявку на предложенных условиях после проверки предоставленных данных.",
    });
    expect(payload.data.decision).not.toHaveProperty("internalReason");
    expect(payload.data.events.at(-1)?.comment).toBe("Банк одобрил заявку на предложенных условиях после проверки предоставленных данных.");
    expect(serialized).not.toContain("Тестовое предложение");
  });

  it("supports the structured MORE_INFO decision branch", async () => {
    const bankCookie = await login("bank");
    const applicationId = createApplication("DECISION");
    const response = await authenticatedRequest(`/api/bank/applications/${applicationId}/decision`, bankCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        type: "MORE_INFO",
        reason: "Уточните назначение крупного платежа поставщику",
        request_type: "COMMENT",
        required_fields: [],
        required_files: [],
        due_days: 5,
      }),
    });

    expect(response.status).toBe(200);
    expect(database.prepare("SELECT status FROM applications WHERE id = ?").get(applicationId)).toEqual({ status: "MORE_INFO" });
    expect(database.prepare("SELECT request_type, status FROM more_info_requests WHERE application_id = ? ORDER BY id DESC LIMIT 1").get(applicationId))
      .toEqual({ request_type: "COMMENT", status: "WAITING_CLIENT" });
  });

  it("rejects an ordinary bank decision while the application is in MORE_INFO", async () => {
    const bankCookie = await login("bank");
    const applicationId = createApplication("MORE_INFO");
    const response = await authenticatedRequest(`/api/bank/applications/${applicationId}/decision`, bankCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        type: "REJECT",
        internal_reason: "Не получены подтверждения, необходимые по внутренней риск-политике",
        client_comment: "Не можем принять решение без запрошенных подтверждающих сведений",
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: expect.any(String) });
    expect(database.prepare("SELECT status, decision FROM applications WHERE id = ?").get(applicationId))
      .toEqual({ status: "MORE_INFO", decision: null });
  });

  it("allows only bank users to retry a SYSTEM_RETRY request", async () => {
    const clientCookie = await login("client1");
    const { applicationId, requestId } = createMoreInfoApplication("SYSTEM_RETRY", "RECHECK");
    const response = await authenticatedRequest(`/api/bank/applications/${applicationId}/more-info/retry`, clientCookie, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });

    expect(response.status).toBe(403);
    expect(database.prepare("SELECT status FROM more_info_requests WHERE id = ?").get(requestId)).toEqual({ status: "RECHECK" });
    expect((database.prepare("SELECT COUNT(*) AS count FROM more_info_responses WHERE request_id = ?").get(requestId) as { count: number }).count).toBe(0);
  });

  it("retries a SYSTEM_RETRY request once and replays the same idempotency key", async () => {
    const bankCookie = await login("bank");
    const { applicationId, requestId } = createMoreInfoApplication("SYSTEM_RETRY", "RECHECK");
    const key = crypto.randomUUID();
    const request = () => authenticatedRequest(`/api/bank/applications/${applicationId}/more-info/retry`, bankCookie, {
      method: "POST",
      headers: { "Idempotency-Key": key },
    });

    const first = await request();
    const firstPayload = await first.json();
    const eventCount = database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(applicationId);
    const replay = await request();

    expect(first.status).toBe(200);
    expect(firstPayload).toEqual({ ok: true, data: expect.objectContaining({ id: applicationId }) });
    expect(database.prepare("SELECT status FROM more_info_requests WHERE id = ?").get(requestId)).toEqual({ status: "CLOSED" });
    expect(database.prepare("SELECT source FROM more_info_responses WHERE request_id = ?").get(requestId)).toEqual({ source: "BANK" });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstPayload);
    expect(database.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?").get(applicationId)).toEqual(eventCount);
    expect((database.prepare("SELECT COUNT(*) AS count FROM more_info_responses WHERE request_id = ?").get(requestId) as { count: number }).count).toBe(1);
  });

  it.each([
    ["COMMENT", "WAITING_CLIENT"],
    ["SYSTEM_RETRY", "CLOSED"],
  ] as const)("returns 409 for retry request type %s in status %s", async (requestType, requestStatus) => {
    const bankCookie = await login("bank");
    const { applicationId, requestId } = createMoreInfoApplication(requestType, requestStatus);
    const response = await authenticatedRequest(`/api/bank/applications/${applicationId}/more-info/retry`, bankCookie, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "Нет системной проверки, ожидающей повтора" });
    expect(database.prepare("SELECT status FROM more_info_requests WHERE id = ?").get(requestId)).toEqual({ status: requestStatus });
    expect((database.prepare("SELECT COUNT(*) AS count FROM more_info_responses WHERE request_id = ?").get(requestId) as { count: number }).count).toBe(0);
  });

  it("does not expose internal score, grade, points or final risk assessment to clients", async () => {
    const clientCookie = await login("client1");
    const client1 = user("client1");
    const application = database.prepare("SELECT id FROM applications WHERE client_id = ? AND decision IS NOT NULL ORDER BY id LIMIT 1").get(client1.id) as { id: number };
    const response = await authenticatedRequest(`/api/applications/${application.id}`, clientCookie);
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(serialized).not.toMatch(/"score":/);
    expect(serialized).not.toMatch(/"grade":/);
    expect(serialized).not.toMatch(/"points":/);
    expect(serialized).not.toContain("finalRiskAssessment");
  });
});
