import { FrameworkError } from "@tripley/web-container-errors";

import type {
  AudioAssetDescriptor,
  PromptDefinition,
  PromptReadinessOptions,
  PromptReadinessResult,
} from "./types";

export class AudioAssetCatalog {
  private readonly assets = new Map<string, AudioAssetDescriptor>();

  public register(asset: AudioAssetDescriptor): void {
    rejectDuplicate(this.assets, asset.id, "prompt.asset.duplicate");
    this.assets.set(asset.id, Object.freeze({ ...asset }));
  }

  public get(id: string): AudioAssetDescriptor | undefined {
    return this.assets.get(id);
  }

  public require(id: string): AudioAssetDescriptor {
    const asset = this.get(id);
    if (!asset) {
      throw promptError("prompt.asset.missing", `Recorded prompt asset is missing: ${id}`, id);
    }
    return asset;
  }

  public list(): readonly AudioAssetDescriptor[] {
    return [...this.assets.values()];
  }
}

export class PromptDefinitionCatalog {
  private readonly prompts = new Map<string, PromptDefinition>();

  public register(prompt: PromptDefinition): void {
    const key = promptKey(prompt.id, prompt.locale);
    rejectDuplicate(this.prompts, key, "prompt.definition.duplicate");
    this.prompts.set(key, Object.freeze({ ...prompt }));
  }

  public require(id: string, locale: string): PromptDefinition {
    const prompt = this.prompts.get(promptKey(id, locale)) ?? this.prompts.get(promptKey(id, "en"));
    if (!prompt) {
      throw promptError("prompt.definition.missing", `Prompt definition is missing: ${id}`, id);
    }
    return prompt;
  }

  public checkReadiness(
    assets: AudioAssetCatalog,
    options: PromptReadinessOptions = { recordedSupported: true, ttsSupported: true },
  ): PromptReadinessResult {
    const missingAssetIds = new Set<string>();
    const missingPromptIds = new Set<string>();
    const unavailableChannels = new Set<"recorded" | "tts">();
    let degraded = false;
    let failed = false;

    for (const prompt of this.prompts.values()) {
      const recordedPolicy =
        prompt.playbackPolicy === "recordedRequired" ||
        prompt.playbackPolicy === "recordedPreferred" ||
        prompt.playbackPolicy === "visualAndRecorded";
      const assetAvailable = Boolean(prompt.recordedAssetId && assets.get(prompt.recordedAssetId));
      const recordedAvailable = recordedPolicy && assetAvailable && options.recordedSupported;
      const ttsAvailable = Boolean(prompt.text && options.ttsSupported);

      if (recordedPolicy && !assetAvailable && prompt.recordedAssetId) {
        missingAssetIds.add(prompt.recordedAssetId);
      }
      if (recordedPolicy && !options.recordedSupported) {
        unavailableChannels.add("recorded");
      }
      if (prompt.playbackPolicy === "recordedPreferred" && !recordedAvailable) {
        if (prompt.allowTtsFallback && ttsAvailable) {
          degraded = true;
        } else {
          failed = true;
          missingPromptIds.add(prompt.id);
        }
      }
      if (
        (prompt.playbackPolicy === "recordedRequired" ||
          prompt.playbackPolicy === "visualAndRecorded") &&
        !recordedAvailable
      ) {
        failed = true;
        missingPromptIds.add(prompt.id);
      }
      if (prompt.playbackPolicy === "ttsRequired" && !ttsAvailable) {
        failed = true;
        missingPromptIds.add(prompt.id);
        unavailableChannels.add("tts");
      }
      if (options.speechRequired && !ttsAvailable) {
        failed = true;
        missingPromptIds.add(prompt.id);
        unavailableChannels.add("tts");
      }
    }

    return {
      missingAssetIds: [...missingAssetIds],
      missingPromptIds: [...missingPromptIds],
      status: failed ? "failed" : degraded ? "degraded" : "ready",
      unavailableChannels: [...unavailableChannels],
    };
  }
}

const promptKey = (id: string, locale: string): string => `${locale}:${id}`;

const rejectDuplicate = <T>(map: Map<string, T>, id: string, code: string): void => {
  if (map.has(id)) {
    throw promptError(code, `Prompt catalog entry already exists: ${id}`, id);
  }
};

const promptError = (code: string, message: string, id: string): FrameworkError =>
  new FrameworkError({ category: "configuration", code, message, metadata: { id } });
