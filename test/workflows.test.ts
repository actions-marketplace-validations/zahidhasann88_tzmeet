import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string | number | boolean>;
}
interface Job {
  if?: string;
  needs?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
  strategy?: { matrix: { node: number[] } };
  environment?: { name: string; url: string };
}
interface Workflow {
  name: string;
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, Job>;
}
/** True when a step uses the given action at any version, so Dependabot bumps don't break these checks. */
const uses = (step: Step, action: string) =>
  step.uses?.startsWith(`${action}@`) ?? false;

function workflow(file: string): Workflow {
  const document = parseDocument(
    readFileSync(`.github/workflows/${file}`, "utf8"),
    { uniqueKeys: true },
  );
  expect(document.errors).toEqual([]);
  return document.toJS() as Workflow;
}

// These regression checks complement actionlint; hosted-runner execution still requires GitHub.
describe("CI and deployment contracts", () => {
  it("ships exactly three well-formed workflows", () => {
    expect(
      readdirSync(".github/workflows")
        .filter((file) => /\.ya?ml$/.test(file))
        .sort(),
    ).toEqual(["ci.yml", "docker.yml", "pages.yml"]);
    expect(workflow("ci.yml").name).toBe("CI");
    expect(workflow("docker.yml").name).toContain("API image");
    expect(workflow("pages.yml").name).toContain("Pages");
  });

  it("checks pushes and PRs on every declared supported CI Node version", () => {
    const ci = workflow("ci.yml");
    expect(Object.keys(ci.on)).toEqual([
      "push",
      "pull_request",
      "workflow_dispatch",
    ]);
    expect(ci.jobs.check!.strategy!.matrix.node).toEqual([20, 22, 24]);
    expect(ci.permissions).toEqual({ contents: "read" });
    const commands = ci.jobs
      .check!.steps!.map((step) => step.run)
      .filter(Boolean);
    for (const command of [
      "pnpm install --frozen-lockfile",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test",
      "pnpm build",
      "pnpm check:package",
    ])
      expect(commands).toContain(command);
    expect(
      ci.jobs["workflow-lint"]!.steps!.some((step) =>
        step.run?.includes("rhysd/actionlint:1.7.7"),
      ),
    ).toBe(true);
  });

  it("pins pnpm to the manifest version and caches the checked-in lockfile", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      packageManager: string;
    };
    for (const file of ["ci.yml", "docker.yml", "pages.yml"]) {
      for (const job of Object.values(workflow(file).jobs)) {
        const pnpm = job.steps?.find((step) => uses(step, "pnpm/action-setup"));
        if (pnpm)
          expect(`pnpm@${pnpm.with!.version}`).toBe(manifest.packageManager);
        const node = job.steps?.find((step) =>
          uses(step, "actions/setup-node"),
        );
        if (node)
          expect(node.with!["cache-dependency-path"]).toBe("pnpm-lock.yaml");
      }
    }
  });

  it("gates desktop/mobile browser checks behind the CI matrix", () => {
    const browser = workflow("ci.yml").jobs.browser!;
    expect(browser.needs).toBe("check");
    expect(browser.steps!.some((step) => step.run === "pnpm test:e2e")).toBe(
      true,
    );
    expect(
      browser.steps!.some((step) =>
        step.run?.includes("playwright install --with-deps chromium"),
      ),
    ).toBe(true);
    expect(
      browser.steps!.find((step) => uses(step, "actions/upload-artifact"))!.if,
    ).toBe("failure()");
  });

  it("deploys only main and never runs a privileged PR deployment", () => {
    const pages = workflow("pages.yml");
    expect(pages.on.push).toEqual({ branches: ["main"] });
    expect(pages.on).not.toHaveProperty("pull_request");
    expect(pages.jobs.build!.if).toBe("github.ref == 'refs/heads/main'");
    expect(pages.jobs.build!.permissions).toEqual({
      contents: "read",
      pages: "read",
    });
    expect(pages.jobs.deploy!.permissions).toEqual({
      pages: "write",
      "id-token": "write",
    });
    expect(pages.jobs.deploy!.needs).toBe("build");
    expect(pages.jobs.deploy!.environment!.name).toBe("github-pages");
    expect(pages.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("uses real Pages metadata, tests the exact prefixed export, and uploads no server files", () => {
    const steps = workflow("pages.yml").jobs.build!.steps!;
    const metadata = steps.find((step) => step.id === "pages")!;
    expect(uses(metadata, "actions/configure-pages")).toBe(true);
    const build = steps.find(
      (step) => step.run === "pnpm --filter @tzmeet/web build",
    )!;
    expect(build.env!.TZMEET_BASE_PATH).toBe(
      "${{ steps.pages.outputs.base_path }}",
    );
    const browser = steps.find((step) => step.run === "pnpm test:e2e")!;
    expect(browser.env!.TZMEET_E2E_BASE_PATH).toBe(build.env!.TZMEET_BASE_PATH);
    expect(browser.env!.TZMEET_E2E_SKIP_BUILD).toBe("1");
    expect(steps.indexOf(browser)).toBeLessThan(
      steps.findIndex((step) => uses(step, "actions/upload-pages-artifact")),
    );
    expect(
      steps.find((step) => uses(step, "actions/upload-pages-artifact"))!.with!
        .path,
    ).toBe("apps/web/out");
  });

  it("keeps package versions and MIT license consistent", () => {
    const manifests = [
      "package.json",
      "packages/core/package.json",
      "packages/cli/package.json",
      "apps/web/package.json",
    ].map(
      (file) => JSON.parse(readFileSync(file, "utf8")) as { version: string },
    );
    expect(new Set(manifests.map((manifest) => manifest.version)).size).toBe(1);
    expect(readFileSync("LICENSE", "utf8")).toContain("MIT License");
    expect(readFileSync("CHANGELOG.md", "utf8")).toContain("[0.1.0]");
  });
});

describe("API CI contracts", () => {
  it("builds/measures a Worker dry-run without deployment credentials", () => {
    const job = workflow("ci.yml").jobs["api-worker"]!;
    const commands = job.steps!.map((step) => step.run).filter(Boolean);
    expect(commands).toContain("pnpm --filter @tzmeet/api... build");
    expect(commands).toContain("pnpm --filter @tzmeet/api worker:dry-run");
    expect(commands).toContain("pnpm --filter @tzmeet/api worker:size");
    expect(
      commands.some(
        (command) =>
          command?.includes("secret put") ||
          command?.includes("wrangler login"),
      ),
    ).toBe(false);
  });
  it("builds/smokes images in CI without registry write access", () => {
    const image = workflow("ci.yml").jobs["api-image"]!;
    expect(image.permissions).toBeUndefined();
    const builds = image.steps!.filter((step) =>
      uses(step, "docker/build-push-action"),
    );
    expect(builds).toHaveLength(1);
    expect(builds[0]!.with!.push).toBe(false);
    expect(image.steps!.some((step) => uses(step, "docker/login-action"))).toBe(
      false,
    );
    expect(
      image.steps!.some((step) => step.run?.includes("curl --fail --silent")),
    ).toBe(true);
  });
  it("publishes to GHCR from a separate workflow, only on version tags, after checks and a smoke test", () => {
    const docker = workflow("docker.yml");
    expect(docker.on).toEqual({ push: { tags: ["v*"] } });
    expect(docker.permissions).toEqual({ contents: "read" });
    const commands = docker.jobs
      .check!.steps!.map((step) => step.run)
      .filter(Boolean);
    for (const command of ["pnpm lint", "pnpm typecheck", "pnpm test"])
      expect(commands).toContain(command);
    const publish = docker.jobs.publish!;
    expect(publish.needs).toBe("check");
    expect(publish.permissions).toEqual({
      contents: "read",
      packages: "write",
    });
    const steps = publish.steps!;
    const smoke = steps.findIndex((step) =>
      step.run?.includes("curl --fail --silent"),
    );
    const push = steps.findIndex(
      (step) =>
        uses(step, "docker/build-push-action") && step.with!.push === true,
    );
    expect(smoke).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(smoke);
  });
});

describe("GitHub Action (action.yml)", () => {
  const action = parseDocument(readFileSync("action.yml", "utf8")).toJS() as {
    inputs: Record<string, { default: string }>;
    runs: {
      using: string;
      steps: { shell: string; env: Record<string, string>; run: string }[];
    };
  };
  const cli = JSON.parse(readFileSync("packages/cli/package.json", "utf8")) as {
    version: string;
  };

  it("runs the published CLI version that matches this release", () => {
    expect(action.runs.using).toBe("composite");
    expect(action.inputs.version!.default).toBe(cli.version);
    expect(action.runs.steps[0]!.run).toContain(
      'npx --yes "tzmeet@${TZMEET_VERSION}" cron --check',
    );
    expect(action.runs.steps[0]!.run).toContain("--format github");
  });

  it("passes inputs through environment variables, never into the script text", () => {
    const step = action.runs.steps[0]!;
    expect(step.run).not.toContain("${{");
    expect(
      Object.values(step.env).every((value) =>
        /^\$\{\{ inputs\.[a-z]+ \}\}$/.test(value),
      ),
    ).toBe(true);
    expect(action.inputs.paths!.default).toBe(".");
    expect(action.inputs.zone!.default).toBe("UTC");
  });
});
