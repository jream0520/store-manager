import path from "node:path";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  webDir: string;
  /** M1 device spike: photo endpoints are disabled unless this is set. Removed once M2 adds login. */
  spikeUploadKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    dataDir: path.resolve(env.DATA_DIR ?? "./data"),
    webDir: path.resolve(env.WEB_DIR ?? "../web/dist"),
    spikeUploadKey: env.SPIKE_UPLOAD_KEY || undefined,
  };
}
