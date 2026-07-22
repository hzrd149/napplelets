interface DebugLogger {
  (...args: unknown[]): void;
  extend(namespace: string): DebugLogger;
}

function createLogger(): DebugLogger {
  const logger = (() => undefined) as DebugLogger;
  logger.extend = () => logger;
  return logger;
}

export default function debug(): DebugLogger {
  return createLogger();
}
