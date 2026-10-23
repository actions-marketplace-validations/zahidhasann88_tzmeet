import { createApp, optionsFromEnv } from "./app.js";
export interface WorkerEnv extends Record<string, string | undefined> {
  API_KEYS?: string;
  CORS_ORIGINS?: string;
  RATE_LIMIT?: string;
  RATE_WINDOW_MS?: string;
  RATE_MAX_BUCKETS?: string;
}

const apps = new WeakMap<WorkerEnv, ReturnType<typeof createApp>>();
export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> | Response {
    let app = apps.get(env);
    if (!app) {
      try {
        app = createApp({
          ...optionsFromEnv(env),
          clientIp: (req) => req.headers.get("CF-Connecting-IP") ?? undefined,
        });
      } catch {
        app = createApp({
          now: () => {
            throw new Error("Invalid Worker configuration");
          },
        });
      }
      apps.set(env, app);
    }
    return app.fetch(request, env);
  },
};
