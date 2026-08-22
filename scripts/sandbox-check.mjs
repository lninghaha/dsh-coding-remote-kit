import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const containerFilter = "name=test-dsh-mobile-remote";

function runDocker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result;
}

function cleanup() {
  try {
    const listed = runDocker(["ps", "-aq", "--filter", containerFilter], {
      capture: true,
      allowFailure: true,
    });
    if (listed.status !== 0 || typeof listed.stdout !== "string") return;

    const ids = listed.stdout.trim().split(/\s+/u).filter(Boolean);
    if (ids.length > 0) {
      runDocker(["rm", "-f", ...ids], { capture: true, allowFailure: true });
    }
  } catch {
    // Cleanup is best-effort and must not mask the build failure.
  }
}

try {
  runDocker(["build", "--target", "check", "--tag", "test-dsh-mobile-remote:check", "."]);
  runDocker([
    "build",
    "--target",
    "isolated-install",
    "--tag",
    "test-dsh-mobile-remote:isolated-install",
    ".",
  ]);
  runDocker(["build", "--target", "verify", "--tag", "test-dsh-mobile-remote:verify", "."]);
  console.log("sandbox verify ok: test-dsh-mobile-remote:verify");
} finally {
  cleanup();
}
