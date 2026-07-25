import {
  createWebSocketXfsControlClient,
  SpExecuteReturnPolicyScope,
  type SetSpExecuteReturnPolicyRequest,
  type SpExecuteReturnPolicyKey,
  type SpExecuteReturnPolicyResponse,
} from "@tripley-kit/xfs-control-client";

export interface XfsCommandFailurePort {
  getSpExecuteReturnPolicy(
    request: SpExecuteReturnPolicyKey,
  ): Promise<SpExecuteReturnPolicyResponse>;
  setSpExecuteReturnPolicy(
    request: SetSpExecuteReturnPolicyRequest,
  ): Promise<unknown>;
  clearSpExecuteReturnPolicy(request: SpExecuteReturnPolicyKey): Promise<unknown>;
}

export interface XfsCommandFailure {
  readonly logicalName: string;
  readonly command: number;
  readonly hresult: number;
}

export interface HostdXfsCommandFailureOptions extends XfsCommandFailure {
  readonly authToken?: string | undefined;
  readonly url?: string | undefined;
}

export async function withXfsCommandFailure<T>(
  runtime: XfsCommandFailurePort,
  fault: XfsCommandFailure,
  action: () => Promise<T>,
): Promise<T> {
  const key = {
    command: fault.command,
    logicalName: fault.logicalName,
  };
  const previous = await runtime.getSpExecuteReturnPolicy(key);
  await runtime.setSpExecuteReturnPolicy({
    policy: {
      command: fault.command,
      hresult: fault.hresult,
      logicalName: fault.logicalName,
      scope: SpExecuteReturnPolicyScope.Volatile,
    },
  });
  try {
    return await action();
  } finally {
    if (previous.policy) {
      await runtime.setSpExecuteReturnPolicy({ policy: previous.policy });
    } else {
      await runtime.clearSpExecuteReturnPolicy(key);
    }
  }
}

export async function withHostdXfsCommandFailure<T>(
  options: HostdXfsCommandFailureOptions,
  action: () => Promise<T>,
): Promise<T> {
  const control = createWebSocketXfsControlClient({
    ...(options.authToken ? { authToken: options.authToken } : {}),
    url: options.url ?? "ws://127.0.0.1:39010",
  });
  try {
    await control.connect();
    return await withXfsCommandFailure(control.runtime, options, action);
  } finally {
    await control.dispose();
  }
}
