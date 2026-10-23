import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

fs.mkdirSync(".tmp/e2e-data", { recursive: true });
if (process.platform !== "win32") fs.chmodSync(".tmp/e2e-data", 0o777);

const dockerBin = process.env.DOCKER_BIN || "docker";
const quotedDockerBin = dockerBin.includes(" ") ? `"${dockerBin}"` : dockerBin;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER ? undefined : {
    command: `${quotedDockerBin} compose -f docker-compose.e2e.yml up --build --force-recreate`,
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
