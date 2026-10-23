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

describe("HTTP authentication, RBAC and command boundaries", () => {
  it("rejects anonymous access with the common 401 envelope", async () => {
    const response = await app.request("/api/applications/mine");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: expect.any(String) });
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
      body: JSON.stringify({ type: "REJECT", reason: "Недостаточная устойчивость денежного потока" }),
    });

    const first = await request();
    const replay = await request();

    expect(first.status).toBe(200);
    expect(database.prepare("SELECT status FROM applications WHERE id = ?").get(applicationId)).toEqual({ status: "REJECTED" });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
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
