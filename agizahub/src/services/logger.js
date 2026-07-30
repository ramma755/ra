const formatMeta = (meta) => (meta ? ` ${JSON.stringify(meta)}` : "");

const logger = {
  info(message, meta) {
    // eslint-disable-next-line no-console
    console.log(`[INFO] ${new Date().toISOString()} ${message}${formatMeta(meta)}`);
  },
  warn(message, meta) {
    // eslint-disable-next-line no-console
    console.warn(
      `[WARN] ${new Date().toISOString()} ${message}${formatMeta(meta)}`
    );
  },
  error(message, meta) {
    // eslint-disable-next-line no-console
    console.error(
      `[ERROR] ${new Date().toISOString()} ${message}${formatMeta(meta)}`
    );
  },
};

module.exports = logger;
