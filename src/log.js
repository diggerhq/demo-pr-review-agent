export function serializeError(error) {
  if (!error) {
    return undefined;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    status: error.status,
    details: error.details,
  };
}

function write(level, message, meta = {}) {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...meta,
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(message, meta) {
    write("info", message, meta);
  },
  warn(message, meta) {
    write("warn", message, meta);
  },
  error(message, meta) {
    write("error", message, meta);
  },
};
