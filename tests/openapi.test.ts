import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: typeof import("../server/app")["app"];
let database: typeof import("../server/db")["db"];
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "alfa-openapi-"));
  process.env.DATA_DIR = dataDir;
  ({ app } = await import("../server/app"));
  ({ db: database } = await import("../server/db"));
});

afterAll(() => {
  database.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

type OpenApiSchema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  anyOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  additionalProperties?: boolean;
};

type OpenApiParameter = {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
};

type OpenApiHeader = {
  description?: string;
  required?: boolean;
  schema?: OpenApiSchema;
};

type OpenApiOperation = {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
  responses?: Record<string, {
    content?: Record<string, { schema?: OpenApiSchema }>;
    headers?: Record<string, OpenApiHeader>;
  }>;
};

type OpenApiDocument = {
  openapi: string;
  security?: Array<Record<string, unknown>>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    securitySchemes?: Record<string, unknown>;
  };
};

function resolveSchema(document: OpenApiDocument, schema: OpenApiSchema): OpenApiSchema {
  if (!schema.$ref) return schema;
  const prefix = "#/components/schemas/";
  expect(schema.$ref.startsWith(prefix)).toBe(true);
  const name = schema.$ref.slice(prefix.length);
  const resolved = document.components?.schemas?.[name];
  expect(resolved, `Missing OpenAPI component ${name}`).toBeDefined();
  return resolved!;
}

function successDataSchema(document: OpenApiDocument, pathName: string, method: "get" | "post"): OpenApiSchema {
  const operation = document.paths[pathName]?.[method];
  expect(operation, `Missing ${method.toUpperCase()} ${pathName}`).toBeDefined();
  const responseSchema = operation?.responses?.["200"]?.content?.["application/json"]?.schema;
  expect(responseSchema, `Missing JSON success schema for ${method.toUpperCase()} ${pathName}`).toBeDefined();
  const envelope = resolveSchema(document, responseSchema!);
  expect(envelope.type).toBe("object");
  expect(envelope.required).toEqual(expect.arrayContaining(["ok", "data"]));
  expect(envelope.properties?.ok?.enum).toEqual([true]);
  const dataSchema = envelope.properties?.data;
  expect(dataSchema, `Missing success data schema for ${method.toUpperCase()} ${pathName}`).toBeDefined();
  return resolveSchema(document, dataSchema!);
}

function expectConcreteSuccessData(document: OpenApiDocument, pathName: string, method: "get" | "post") {
  const schema = successDataSchema(document, pathName, method);
  expect(
    schema.type !== undefined || schema.anyOf !== undefined || schema.oneOf !== undefined,
    `Unknown success data schema for ${method.toUpperCase()} ${pathName}`,
  ).toBe(true);
}

function expectRequiredObject(schema: OpenApiSchema, requiredProperties: string[]) {
  expect(schema.type).toBe("object");
  expect(schema.required).toEqual(expect.arrayContaining(requiredProperties));
  for (const property of requiredProperties) expect(schema.properties?.[property], `Missing property ${property}`).toBeDefined();
}

function expectArrayItems(document: OpenApiDocument, schema: OpenApiSchema): OpenApiSchema {
  expect(schema.type).toBe("array");
  expect(schema.items).toBeDefined();
  return resolveSchema(document, schema.items!);
}

describe("OpenAPI contract", () => {
  it("publishes a complete OpenAPI 3.1 document", async () => {
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);
    const document = await response.json() as OpenApiDocument;

    expect(document.openapi).toBe("3.1.0");
    expect(document.security).toEqual([{ cookieAuth: [] }]);
    expect(document.components?.securitySchemes?.cookieAuth).toEqual({
      type: "apiKey",
      in: "cookie",
      name: "sid",
    });
    expect(document.components?.schemas).toEqual(expect.objectContaining({
      ApiError: expect.any(Object),
      ApplicationStatus: expect.any(Object),
      DecisionType: expect.any(Object),
      DocumentStatus: expect.any(Object),
      ClientApplication: expect.any(Object),
      BankApplication: expect.any(Object),
      BankDossier: expect.any(Object),
    }));
    expect(document.components?.schemas?.GenericSuccess).toBeUndefined();

    const operations = Object.values(document.paths).flatMap((pathItem) =>
      Object.entries(pathItem)
        .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
        .map(([, operation]) => operation),
    );
    expect(operations).toHaveLength(33);

    const operationIds = operations.map((operation) => operation.operationId);
    expect(operationIds.every(Boolean)).toBe(true);
    expect(new Set(operationIds).size).toBe(operationIds.length);

    for (const operation of operations) {
      expect(operation.responses).toBeDefined();
      for (const responseDefinition of Object.values(operation.responses ?? {})) {
        expect(responseDefinition.content).toBeDefined();
        for (const mediaType of Object.values(responseDefinition.content ?? {})) {
          expect(mediaType.schema).toBeDefined();
        }
      }
    }
  });

  it("documents separated bank decision texts without exposing internal rationale in the client contract", async () => {
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);
    const document = await response.json() as OpenApiDocument;
    const operation = document.paths["/api/bank/applications/{id}/decision"]?.post;
    const requestSchema = operation?.requestBody?.content?.["application/json"]?.schema;
    expect(requestSchema).toBeDefined();
    const variants = requestSchema?.oneOf ?? requestSchema?.anyOf ?? [];
    expect(variants).toHaveLength(7);
    const variantsPerType = new Map<string, number>();

    for (const unresolvedVariant of variants) {
      const variant = resolveSchema(document, unresolvedVariant);
      const decisionType = variant.properties?.type?.enum?.[0];
      expect(decisionType).toBeDefined();
      variantsPerType.set(decisionType!, (variantsPerType.get(decisionType!) ?? 0) + 1);
      if (decisionType === "MORE_INFO") {
        expect(variant.required).toContain("reason");
        expect(variant.properties).not.toHaveProperty("internal_reason");
        expect(variant.properties).not.toHaveProperty("client_comment");
      } else if (variant.properties?.reason) {
        expect(["APPROVE", "CONDITIONS", "REJECT"]).toContain(decisionType);
        expect(variant.required).toContain("reason");
        expect(variant.properties).not.toHaveProperty("internal_reason");
        expect(variant.properties).not.toHaveProperty("client_comment");
      } else {
        expect(["APPROVE", "CONDITIONS", "REJECT"]).toContain(decisionType);
        expect(variant.required).toEqual(expect.arrayContaining(["internal_reason", "client_comment"]));
        expect(variant.properties).not.toHaveProperty("reason");
      }
    }
    expect(Object.fromEntries(variantsPerType)).toEqual({ APPROVE: 2, CONDITIONS: 2, MORE_INFO: 1, REJECT: 2 });

    const bankContract = JSON.stringify(document.components?.schemas?.BankApplication);
    const clientContract = JSON.stringify(document.components?.schemas?.ClientApplication);
    expect(bankContract).toContain("internalReason");
    expect(bankContract).toContain("clientComment");
    expect(clientContract).toContain("clientComment");
    expect(clientContract).not.toContain("internalReason");
  });

  it("documents idempotency headers for exactly the idempotent operations", async () => {
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);
    const document = await response.json() as OpenApiDocument;
    const expectedOperationIds = [
      "createApplication",
      "acknowledgeDocuments",
      "acceptOffer",
      "signDocuments",
      "declineOffer",
      "makeBankDecision",
      "issueApplication",
      "retryExternalChecks",
    ];
    const operations = Object.values(document.paths).flatMap((pathItem) =>
      Object.entries(pathItem)
        .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
        .map(([, operation]) => operation),
    );
    const operationsWithIdempotencyKey = operations.filter((operation) =>
      operation.parameters?.some((parameter) => parameter.in === "header" && parameter.name?.toLowerCase() === "idempotency-key"),
    );

    expect(operationsWithIdempotencyKey.map((operation) => operation.operationId).sort()).toEqual(expectedOperationIds.sort());
    for (const operation of operationsWithIdempotencyKey) {
      const requestHeader = operation.parameters?.find((parameter) =>
        parameter.in === "header" && parameter.name?.toLowerCase() === "idempotency-key",
      );
      expect(requestHeader).toMatchObject({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: {
          type: "string",
          minLength: 8,
          maxLength: 128,
          pattern: "^[A-Za-z0-9._:-]+$",
        },
      });
      expect(requestHeader?.description).toEqual(expect.any(String));

      const replayHeader = operation.responses?.["200"]?.headers?.["Idempotency-Replayed"];
      expect(replayHeader).toMatchObject({
        schema: { type: "string", enum: ["true"] },
      });
      expect(replayHeader?.required).toBeUndefined();
      expect(replayHeader?.description).toMatch(/воспроизвед|replay/i);
    }
  });

  it("publishes concrete success payloads for key endpoints", async () => {
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);
    const document = await response.json() as OpenApiDocument;
    const jsonEndpoints = [
      ["/api/auth/login", "post"],
      ["/api/auth/logout", "post"],
      ["/api/auth/me", "get"],
      ["/api/client/profile", "get"],
      ["/api/client/profile/benefits/preview", "post"],
      ["/api/health", "get"],
      ["/api/products", "get"],
      ["/api/products/{id}", "get"],
      ["/api/calculator/evaluate", "post"],
      ["/api/calculator/runs/{id}", "get"],
      ["/api/applications", "post"],
      ["/api/applications/mine", "get"],
      ["/api/applications/{id}", "get"],
      ["/api/applications/{id}/documents/acknowledge", "post"],
      ["/api/applications/{id}/accept", "post"],
      ["/api/applications/{id}/sign", "post"],
      ["/api/applications/{id}/decline", "post"],
      ["/api/applications/{id}/more-info/{requestId}/response", "post"],
      ["/api/applications/{id}/respond", "post"],
      ["/api/applications/{id}/financials", "post"],
      ["/api/news", "get"],
      ["/api/assistant", "post"],
      ["/api/bank/queue", "get"],
      ["/api/bank/applications/{id}", "get"],
      ["/api/bank/applications/{id}/decision", "post"],
      ["/api/bank/applications/{id}/issue", "post"],
      ["/api/bank/applications/{id}/financial-reports/{reportId}/review", "post"],
      ["/api/bank/applications/{id}/more-info/retry", "post"],
      ["/api/bank/applications/{id}/recommendation", "get"],
      ["/api/bank/applications/{id}/summary", "get"],
      ["/api/mocks/bki/{inn}", "get"],
      ["/api/mocks/egrul/{inn}", "get"],
    ] as const;

    for (const [pathName, method] of jsonEndpoints) {
      expectConcreteSuccessData(document, pathName, method);
    }

    const documentDownload = document.paths["/api/documents/{id}/download"]?.get
      .responses?.["200"]?.content?.["text/plain"]?.schema;
    expect(documentDownload).toBeDefined();
    expect(resolveSchema(document, documentDownload!)).toMatchObject({ type: "string" });
  });

  it("publishes meaningful schemas for profile, news, logout and command responses", async () => {
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);
    const document = await response.json() as OpenApiDocument;

    const logout = successDataSchema(document, "/api/auth/logout", "post");
    expect(logout.type).toBe("null");

    const profile = successDataSchema(document, "/api/client/profile", "get");
    expectRequiredObject(profile, ["user", "company", "financials", "credit_history", "indicators", "benefits", "benefits_metadata", "benefits_disclaimer"]);
    const profileFinancials = expectArrayItems(document, profile.properties!.financials!);
    expectRequiredObject(profileFinancials, ["id", "year", "revenue", "profit", "status", "source", "submitted_at"]);
    expect(profileFinancials.properties?.year?.type).toBe("integer");
    const profileBenefits = expectArrayItems(document, profile.properties!.benefits!);
    expectRequiredObject(profileBenefits, ["id", "title", "status", "verificationStatus", "applicability", "source", "requirements"]);
    expect(profileBenefits.properties?.requirements?.type).toBe("array");
    expect(profileBenefits.properties?.requirements?.items?.type).toBe("string");

    const previewOperation = document.paths["/api/client/profile/benefits/preview"]?.post;
    const previewRequestSchema = previewOperation?.requestBody?.content?.["application/json"]?.schema;
    expect(previewRequestSchema).toBeDefined();
    const previewRequest = resolveSchema(document, previewRequestSchema!);
    expectRequiredObject(previewRequest, ["region", "sme_status", "purpose"]);
    expect(previewRequest.additionalProperties).toBe(false);
    expect(previewRequest.properties?.sme_status?.enum).toEqual(["micro", "small", "medium", "not_sme", "unknown"]);
    expect(previewRequest.properties?.purpose?.enum).toEqual(["working_capital", "investment", "guarantee", "digitalization", "consulting", "other"]);

    const preview = successDataSchema(document, "/api/client/profile/benefits/preview", "post");
    expectRequiredObject(preview, ["items", "metadata"]);
    const previewItem = expectArrayItems(document, preview.properties!.items!);
    expectRequiredObject(previewItem, ["item", "reasons", "unknowns"]);
    expect(previewItem.properties).not.toHaveProperty("score");
    const previewMetadata = resolveSchema(document, preview.properties!.metadata!);
    expectRequiredObject(previewMetadata, ["eligibilityChecked", "externalDataUsed", "answersPersisted"]);
    expect(previewMetadata.properties?.eligibilityChecked?.enum).toEqual([false]);
    expect(previewMetadata.properties?.externalDataUsed?.enum).toEqual([false]);
    expect(previewMetadata.properties?.answersPersisted?.enum).toEqual([false]);

    const newsItems = expectArrayItems(document, successDataSchema(document, "/api/news", "get"));
    expectRequiredObject(newsItems, ["id", "title", "body", "tags", "published_at", "personalized", "matched_tag", "rank"]);
    expect(newsItems.properties?.personalized?.type).toBe("boolean");
    expect(newsItems.properties?.matched_tag?.type).toEqual(["string", "null"]);

    const clientMoreInfo = successDataSchema(document, "/api/applications/{id}/more-info/{requestId}/response", "post");
    expectRequiredObject(clientMoreInfo, ["id", "public_no", "status", "decision", "more_info_requests", "active_more_info_request", "preapproval"]);
    const clientMoreInfoRequests = expectArrayItems(document, clientMoreInfo.properties!.more_info_requests!);
    expectRequiredObject(clientMoreInfoRequests, ["id", "applicationId", "type", "reason", "requiredFields", "requiredFiles", "status", "response"]);
    expect(clientMoreInfoRequests.properties?.requiredFields?.type).toBe("array");
    expect(clientMoreInfoRequests.properties?.requiredFields?.items?.type).toBe("string");
    expect(clientMoreInfo.properties).not.toHaveProperty("score");
    expect(clientMoreInfo.properties).not.toHaveProperty("grade");
    expect(clientMoreInfo.properties).not.toHaveProperty("scorecard_version");
    expect(clientMoreInfo.properties).not.toHaveProperty("decided_by");
    expect(clientMoreInfo.properties?.decision?.properties).not.toHaveProperty("finalRiskAssessment");

    const bankRetry = successDataSchema(document, "/api/bank/applications/{id}/more-info/retry", "post");
    expectRequiredObject(bankRetry, ["id", "public_no", "status", "score", "grade", "score_details", "scorecard_version", "decided_by", "decision"]);
    const bankMoreInfoRequests = expectArrayItems(document, bankRetry.properties!.more_info_requests!);
    expectRequiredObject(bankMoreInfoRequests, ["id", "type", "status", "source", "dueAt"]);

    const reviewedReport = successDataSchema(document, "/api/bank/applications/{id}/financial-reports/{reportId}/review", "post");
    expectRequiredObject(reviewedReport, [
      "id", "companyId", "applicationId", "year", "revenue", "profit", "ownCapital", "monthlyObligations",
      "status", "source", "submittedBy", "verifiedBy", "submittedAt", "verifiedAt", "rejectedAt", "rejectionReason",
    ]);
    expect(reviewedReport.properties?.year?.type).toBe("integer");
    expect(reviewedReport.properties?.status?.enum).toEqual(["SUBMITTED", "VERIFIED", "REJECTED"]);

    const dossier = successDataSchema(document, "/api/bank/applications/{id}", "get");
    expectRequiredObject(dossier, ["score", "grade", "score_details", "scoring_input", "external_checks", "financial_reports"]);
    expect(dossier.properties?.score_details?.type).toEqual(["array", "null"]);
    expect(dossier.properties?.score_details?.items).toBeDefined();
    expect(dossier.properties?.decision?.properties?.finalRiskAssessment).toBeDefined();
  });

  it("pins the browser API reference asset", async () => {
    const response = await app.request("/api/docs");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.75.1",
    );
  });

  it("returns validation errors in the common JSON envelope", async () => {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: "", password: "" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });
});
