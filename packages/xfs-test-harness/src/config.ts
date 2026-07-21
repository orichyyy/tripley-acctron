export interface XfsHostdTestConfig {
  readonly appId: string;
  readonly authToken?: string | undefined;
  readonly bcrLogicalName?: string | undefined;
  readonly cimLogicalName?: string | undefined;
  readonly cimInputPosition: number;
  readonly cimOutputPosition: number;
  readonly cimResourceGroup: string;
  readonly idcLogicalName?: string | undefined;
  readonly expectedGeneration: number;
  readonly pinCustomerData: string;
  readonly pinKeyName: string;
  readonly pinLogicalName?: string | undefined;
  readonly protectionProfileId: string;
  readonly timeoutMs: number;
  readonly url: string;
}

export const xfsHostdTestConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): XfsHostdTestConfig => ({
  appId: env.TRIPLEY_XFS_APP_ID ?? "tripley-acctron-contract",
  ...(env.TRIPLEY_NATIVE_HOSTD_AUTH_TOKEN
    ? { authToken: env.TRIPLEY_NATIVE_HOSTD_AUTH_TOKEN }
    : {}),
  ...(env.TRIPLEY_XFS_BCR_LOGICAL_NAME ? { bcrLogicalName: env.TRIPLEY_XFS_BCR_LOGICAL_NAME } : {}),
  ...(env.TRIPLEY_XFS_CIM_LOGICAL_NAME ? { cimLogicalName: env.TRIPLEY_XFS_CIM_LOGICAL_NAME } : {}),
  cimInputPosition: Number(env.TRIPLEY_XFS_CIM_INPUT_POSITION ?? 4),
  cimOutputPosition: Number(env.TRIPLEY_XFS_CIM_OUTPUT_POSITION ?? 512),
  cimResourceGroup: env.TRIPLEY_XFS_CIM_RESOURCE_GROUP ?? "cash-transport-1",
  ...(env.TRIPLEY_XFS_IDC_LOGICAL_NAME ? { idcLogicalName: env.TRIPLEY_XFS_IDC_LOGICAL_NAME } : {}),
  expectedGeneration: Number(env.TRIPLEY_XFS_EXPECTED_GENERATION ?? 1),
  pinCustomerData: env.TRIPLEY_XFS_PIN_CUSTOMER_DATA ?? "123456789012",
  pinKeyName: env.TRIPLEY_XFS_PIN_KEY_NAME ?? "TripleyConformanceCrypt",
  ...(env.TRIPLEY_XFS_PIN_LOGICAL_NAME ? { pinLogicalName: env.TRIPLEY_XFS_PIN_LOGICAL_NAME } : {}),
  protectionProfileId: env.TRIPLEY_XFS_PROTECTION_PROFILE ?? "real-smoke",
  timeoutMs: Number(env.TRIPLEY_XFS_TIMEOUT_MS ?? 10_000),
  url: env.TRIPLEY_NATIVE_HOSTD_URL ?? "ws://127.0.0.1:39010",
});
