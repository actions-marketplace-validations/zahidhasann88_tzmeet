import { createApp, optionsFromEnv } from './app.js';
export interface WorkerEnv extends Record<string, string | undefined> {
  API_KEYS?: string; CORS_ORIGINS?: string; RATE_LIMIT?: string; RATE_WINDOW_MS?: string; RATE_MAX_BUCKETS?: string;
}
/** Reuse the app/counters across requests to one environment in this isolate.
 * Binding identity changes (e.g. secret rotation) construct a fresh app. No DB/KV.
 */
const apps = new WeakMap<WorkerEnv, ReturnType<typeof createApp>>();
export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> | Response {
    let app = apps.get(env);
    if (!app) {
      try {
        app = createApp({ ...optionsFromEnv(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? undefined });
      } catch {
        // Fail closed through the regular JSON/security/logging middleware rather
        // than exposing configuration exceptions from the adapter.
        app = createApp({ now: () => { throw new Error('Invalid Worker configuration'); } });
      }
      apps.set(env, app);
    }
    return app.fetch(request, env);
  }
};
