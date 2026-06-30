import { defineFlow, defineUserInputNode, defineNode } from '@tripley/web-container-flow-engine';

export const withdrawalFlow = defineFlow({
  id: 'kiosk.withdrawal',
  version: '1.0.0',
  startNodeId: 'enterAmount',
  concurrency: { mode: 'reject', key: 'kiosk.withdrawal' },
  policies: {
    userInputTimeout: { timeoutMs: 30_000, onTimeout: { type: 'next', nodeId: 'returnToMainMenu' } },
    interrupts: [
      { id: 'card.removed', priority: 100, eventTopic: 'device.card.removed', action: { type: 'cancelFlow', reasonCode: 'CARD.REMOVED' } },
      { id: 'headphone.removed.blindMode', priority: 90, eventTopic: 'device.siu.headphone.removed', appliesTo: 'accessibility.blindMode.enabled', action: { type: 'cancelFlow', reasonCode: 'HEADPHONE.REMOVED' } },
    ],
  },
  nodes: {
    enterAmount: defineUserInputNode({
      id: 'enterAmount',
      input: {
        semantic: 'amount',
        security: 'plain',
        ui: { path: '/withdrawal/amount', stateKey: 'withdrawal.amountInput', promptKey: 'withdrawal.amount.prompt' },
        sources: [
          { id: 'pinpad', kind: 'pinpad.data', required: true, options: { dataType: 'numeric', minLength: 1, maxLength: 10 } },
          { id: 'mobileQr', kind: 'barcodeReader.qr', required: false, enabledWhen: 'device.barcodeReader.available', options: { formats: ['qr'], parseAs: 'mobileAppInput' } },
          { id: 'screenCommand', kind: 'ui.command', required: false, commandId: 'withdrawal.amount.confirmed' },
        ],
        acceptance: { mode: 'race', firstValidWins: true },
        validation: { validatorId: 'withdrawal.amount.valid', failure: { mode: 'stayOnNode', maxAttempts: 3 } },
      },
      next: 'enterPin',
    }),

    enterPin: defineUserInputNode({
      id: 'enterPin',
      input: {
        semantic: 'pin',
        security: 'secure',
        ui: { path: '/auth/pin', stateKey: 'auth.pinInput', promptKey: 'auth.pin.prompt' },
        sources: [
          { id: 'pinpad', kind: 'pinpad.pin', required: true, options: { minLength: 4, maxLength: 12, pinBlockFormat: 'ISO9564-0', keySlot: 'bank.default' } },
        ],
        acceptance: { mode: 'single' },
        cleanup: { cancelDevicesOnExit: true },
        trace: { safeToLog: false, summaryOnly: true },
      },
      next: 'sendHostRequest',
    }),

    sendHostRequest: defineNode({
      id: 'sendHostRequest',
      kind: 'action',
      run: async (ctx) => {
        const host = ctx.services.get('bank.host');
        const result = await host.withdrawalAuthorize(ctx.shared.transaction);
        return result.approved
          ? { type: 'next', nodeId: 'dispenseCash', output: result }
          : { type: 'next', nodeId: 'showRejected', output: result };
      },
    }),
  },
  edges: [
    { from: 'enterAmount', to: 'enterPin' },
    { from: 'enterPin', to: 'sendHostRequest' },
  ],
  finally: async (ctx) => {
    await ctx.tts.stop();
    await ctx.scopedStore.resetTransaction('withdrawal.finished');
  },
});
