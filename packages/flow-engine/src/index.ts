export interface FlowEngine<TInput = unknown, TOutput = unknown> {
  start(input: TInput): Promise<TOutput>;
  cancel(reason: string): Promise<void>;
}

export interface FlowEngineFactory<TInput = unknown, TOutput = unknown> {
  create(): FlowEngine<TInput, TOutput>;
}
