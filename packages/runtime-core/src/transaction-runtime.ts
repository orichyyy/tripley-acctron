import type {
  RecoveryPort,
  RecoveryReason,
  RuntimeSnapshot
} from '@tripley-acctron/contracts'
import { logError } from '@tripley-acctron/observability'
import type { ILogger } from '@tripley-kit/logger'
import type { ServiceStateController } from './service-state.js'

export class TransactionRuntime {
  public constructor (
    private readonly state: ServiceStateController,
    private readonly recovery: RecoveryPort,
    private readonly logger: ILogger
  ) {}

  public getSnapshot (): RuntimeSnapshot {
    return this.state.getSnapshot()
  }

  public async run<T> (operation: () => Promise<T>): Promise<T> {
    this.state.beginTransaction()
    try {
      const result = await operation()
      this.state.finishTransaction()
      return result
    } catch (error) {
      await this.recover({ kind: 'unhandled-error', error })
      throw error
    }
  }

  public async recover (reason: RecoveryReason): Promise<void> {
    this.state.beginRecovery()
    this.logger.warn('Transaction recovery started', {
      eventId: 'transaction.recovery.started',
      module: 'transaction',
      action: 'recover',
      data: { reason: reason.kind }
    })
    try {
      await this.recovery.releaseAllHeldMedia(reason)
    } catch (error) {
      logError(this.logger, 'Failed to release all held media', error, {
        eventId: 'transaction.recovery.release_media.failed',
        module: 'transaction',
        action: 'release-all-held-media'
      })
    } finally {
      this.state.finishTransaction()
    }
  }
}
