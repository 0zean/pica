export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const stderrLogger: Logger = {
  info: (message) => {
    process.stderr.write(`picad: ${message}\n`);
  },
  warn: (message) => {
    process.stderr.write(`picad: warning: ${message}\n`);
  },
  error: (message) => {
    process.stderr.write(`picad: error: ${message}\n`);
  },
};

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
