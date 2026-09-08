import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
