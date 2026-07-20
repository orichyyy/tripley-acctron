import { FrameworkError } from "@tripley-kit/web-container-errors";

export interface HealthCheckResult {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly message?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}

export interface HealthCheck {
  readonly id: string;
  run(): Promise<HealthCheckResult>;
}

export class HealthCheckCenter {
  private readonly checks = new Map<string, HealthCheck>();

  public register(check: HealthCheck): void {
    if (this.checks.has(check.id)) {
      throw new FrameworkError({
        category: "extension",
        code: "healthCheck.duplicate",
        message: `Health check already registered: ${check.id}`,
        metadata: { healthCheckId: check.id },
      });
    }
    this.checks.set(check.id, check);
  }

  public async runAll(): Promise<HealthCheckResult[]> {
    return Promise.all([...this.checks.values()].map((check) => check.run()));
  }
}
