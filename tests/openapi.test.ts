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

type OpenApiOperation = {
  operationId?: string;
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

type OpenApiDocument = {
  openapi: string;
  security?: Array<Record<string, unknown>>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
};

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
      GenericSuccess: expect.any(Object),
      ApplicationStatus: expect.any(Object),
      DecisionType: expect.any(Object),
      DocumentStatus: expect.any(Object),
    }));

    const operations = Object.values(document.paths).flatMap((pathItem) =>
      Object.entries(pathItem)
        .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
        .map(([, operation]) => operation),
    );
    expect(operations).toHaveLength(32);

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
