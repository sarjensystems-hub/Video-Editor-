import { after } from "next/server";

/**
 * Runs work that has to outlive the HTTP response.
 *
 * A Vercel function is frozen the instant it returns, so a floating promise
 * stops making progress mid-render and leaves the job row stuck in `rendering`
 * forever. `after()` is the supported way to keep the invocation alive until
 * the work settles. Outside a request scope — unit tests, scripts — it throws,
 * and there the work simply runs inline.
 */
export function runAfterResponse(work: () => Promise<unknown>): void {
  const settle = () =>
    work().catch(() => {
      // Every background job records its own failure on the job row; there is
      // no caller left here to report one to.
    });
  try {
    after(settle);
  } catch {
    void settle();
  }
}
