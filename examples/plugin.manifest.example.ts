import type { PluginModule } from '@tripley/web-container-plugin-system';

export const idCardReaderPlugin: PluginModule = {
  manifest: {
    id: 'plugin.bank.idCardReader',
    name: 'Bank ID Card Reader',
    version: '1.0.0',
    type: ['service', 'flow', 'native-adapter'],
    compatibility: {
      frameworkVersion: '^1.0.0',
      nativeCapabilities: ['device.idCardReader'],
    },
    permissions: {
      native: ['device.idCardReader'],
      devices: ['idCardReader'],
      inputSources: ['bank.idCardReader.identity'],
    },
    contributes: {
      devices: [{ id: 'idCardReader', type: 'idCardReader' }],
      inputSources: [{ kind: 'bank.idCardReader.identity', security: 'sensitive' }],
      conditions: [{ id: 'device.idCardReader.available' }],
    },
  },

  register(ctx) {
    ctx.devices.register('idCardReader', createIdCardReaderPort(ctx.native.extensions));
    ctx.inputSources.register('bank.idCardReader.identity', new IdCardReaderInputSourceAdapter());
    ctx.conditions.register({
      id: 'device.idCardReader.available',
      evaluate: async () => ctx.devices.has('idCardReader'),
    });
  },
};
