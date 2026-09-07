// Minimal logger for the scripts package (pino-compatible shape).
export const logger = {
  info: (obj: unknown, msg?: string) => {
    if (typeof obj === "string") console.log(`[INFO] ${obj}`);
    else console.log(`[INFO] ${msg ?? ""} ${JSON.stringify(obj)}`);
  },
  error: (obj: unknown, msg?: string) => {
    if (typeof obj === "string") console.error(`[ERROR] ${obj}`);
    else console.error(`[ERROR] ${msg ?? ""} ${JSON.stringify(obj)}`);
  },
};
