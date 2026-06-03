import { InteractionRecorder } from '@tripley-acctron/observability'
import {
  ServiceStateController,
  TransactionRuntime
} from '@tripley-acctron/runtime-core'
import { MemoryJournal, MemoryRecovery } from '@tripley-acctron/testing'
import { noopLogger } from '@tripley-kit/logger'

export async function runHeadlessAtmExample () {
  const journal = new MemoryJournal()
  const recovery = new MemoryRecovery()
  const state = new ServiceStateController()
  const runtime = new TransactionRuntime(state, recovery, noopLogger)
  const interactions = new InteractionRecorder(noopLogger, journal)

  await runtime.run(async () => {
    await interactions.record({
      action: 'select-transaction',
      code: 'withdrawal',
      source: 'touchscreen'
    })
    state.requestAvailability('out-of-service')
  })

  try {
    state.requestAvailability('in-service')
    await runtime.run(async () => {
      await interactions.record({
        action: 'pinpad-key',
        code: 'confirm',
        source: 'pinpad'
      })
      throw new Error('Simulated dispenser failure')
    })
  } catch {
    // The example intentionally demonstrates transaction-boundary recovery.
  }

  return {
    journal: journal.entries,
    recoveries: recovery.reasons,
    snapshot: runtime.getSnapshot()
  }
}
