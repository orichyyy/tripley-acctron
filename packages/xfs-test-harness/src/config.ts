export interface XfsHostdTestConfig {
  readonly appId: string;
  readonly authToken?: string | undefined;
  readonly bcrLogicalName?: string | undefined;
  readonly idcLogicalName?: string | undefined;
  readonly expectedGeneration: number;
  readonly pinCustomerData: string;
  readonly pinKeyName: string;
  readonly pinLogicalName?: string | undefined;
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
  ...(env.TRIPLEY_XFS_IDC_LOGICAL_NAME ? { idcLogicalName: env.TRIPLEY_XFS_IDC_LOGICAL_NAME } : {}),
  expectedGeneration: Number(env.TRIPLEY_XFS_EXPECTED_GENERATION ?? 1),
  pinCustomerData: env.TRIPLEY_XFS_PIN_CUSTOMER_DATA ?? "123456789012",
  pinKeyName: env.TRIPLEY_XFS_PIN_KEY_NAME ?? "TripleyConformanceCrypt",
  ...(env.TRIPLEY_XFS_PIN_LOGICAL_NAME ? { pinLogicalName: env.TRIPLEY_XFS_PIN_LOGICAL_NAME } : {}),
  timeoutMs: Number(env.TRIPLEY_XFS_TIMEOUT_MS ?? 10_000),
  url: env.TRIPLEY_NATIVE_HOSTD_URL ?? "ws://127.0.0.1:39010",
});
