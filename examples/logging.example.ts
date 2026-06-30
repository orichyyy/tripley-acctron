const flowLogger = logger.child({ module: 'flow-engine' });

flowLogger.info('Flow node completed', {
  eventId: 'flow.node.completed',
  eventName: 'Flow node completed',
  action: 'complete-node',
  traceId,
  data: {
    flowId: 'kiosk.withdrawal',
    flowInstanceId,
    flowNodeId: 'enterAmount',
    durationMs: 41,
  },
});

flowLogger.error('Flow node failed', error, {
  eventId: 'flow.node.failed',
  eventName: 'Flow node failed',
  action: 'run-node',
  traceId,
  data: {
    flowId: 'kiosk.withdrawal',
    flowInstanceId,
    flowNodeId: 'sendHostRequest',
  },
});
