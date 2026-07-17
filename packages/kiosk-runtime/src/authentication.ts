import { FrameworkError } from "@tripley/web-container-errors";

import type { AuthenticationChallengeRegistry } from "./registries";
import type {
  AuthenticationPlan,
  AuthenticationRequirement,
  CapabilitySnapshot,
  CredentialAssessment,
} from "./types";

export class LocalAuthenticationPlanPolicy {
  public constructor(
    private readonly challenges: AuthenticationChallengeRegistry,
    private readonly mandatory: (
      assessment: CredentialAssessment,
    ) => readonly AuthenticationRequirement[] = () => [],
  ) {}

  public build(
    assessment: CredentialAssessment,
    capabilities: CapabilitySnapshot,
  ): AuthenticationPlan {
    const requirements = mergeRequirements(this.mandatory(assessment), assessment.requirements);
    const items = requirements.map((requirement) => {
      const challenge = this.challenges.get(requirement.kind);
      if (!challenge) {
        throw authenticationError(
          "authentication.challenge.unknown",
          `Authentication challenge is not registered: ${requirement.kind}`,
          requirement.kind,
        );
      }
      for (const capability of challenge.requiredCapabilities ?? []) {
        if (capabilities.status(capability) !== "available") {
          throw authenticationError(
            "authentication.challenge.unavailable",
            `Authentication capability is unavailable: ${capability}`,
            requirement.kind,
          );
        }
      }
      challenge.validateParameters?.(requirement.parameters ?? {});
      const frozenRequirement = Object.freeze({
        ...requirement,
        ...(requirement.parameters
          ? { parameters: Object.freeze({ ...requirement.parameters }) }
          : {}),
      });
      return Object.freeze({
        challengeId: challenge.id,
        challengeVersion: challenge.version,
        requirement: frozenRequirement,
      });
    });
    return Object.freeze({ items: Object.freeze(items) });
  }
}

const mergeRequirements = (
  mandatory: readonly AuthenticationRequirement[],
  assessed: readonly AuthenticationRequirement[],
): AuthenticationRequirement[] => {
  const merged = new Map<string, AuthenticationRequirement>();
  for (const requirement of assessed) {
    merged.set(requirement.kind, requirement);
  }
  for (const requirement of mandatory) {
    const remote = merged.get(requirement.kind);
    merged.set(requirement.kind, {
      ...remote,
      ...requirement,
      parameters:
        remote?.parameters || requirement.parameters
          ? { ...remote?.parameters, ...requirement.parameters }
          : undefined,
    });
  }
  return [...merged.values()];
};

const authenticationError = (code: string, message: string, kind: string): FrameworkError =>
  new FrameworkError({ category: "dependency", code, message, metadata: { kind } });
