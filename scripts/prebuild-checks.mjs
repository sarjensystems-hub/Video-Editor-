// Runs the test suite and type check before a local `npm run build`.
// Skipped on Vercel: tests run in GitHub Actions (.github/workflows/ci.yml),
// and `next build` type-checks again on its own, so a type error still fails
// the deploy. Running both here added about a minute to every deployment.
import { execSync } from "node:child_process";

if (process.env.VERCEL) {
  console.log("[prebuild] on Vercel: tests run in GitHub Actions, next build type-checks");
  process.exit(0);
}
execSync("npx vitest run", { stdio: "inherit" });
execSync("npx tsc --noEmit", { stdio: "inherit" });
