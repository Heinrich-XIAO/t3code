import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CheckpointRef } from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path } from "effect";

import { GitService } from "../../git/Services/GitService.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import { CheckpointStoreLive } from "./CheckpointStore.ts";

const TEST_COMMIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "T3 Code Test",
  GIT_AUTHOR_EMAIL: "t3code-test@example.com",
  GIT_COMMITTER_NAME: "T3 Code Test",
  GIT_COMMITTER_EMAIL: "t3code-test@example.com",
};

const CheckpointStoreTestLayer = CheckpointStoreLive.pipe(Layer.provide(NodeServices.layer));
const layer = it.layer(Layer.mergeAll(NodeServices.layer, CheckpointStoreTestLayer));

function git(
  cwd: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv,
): Effect.Effect<string, Error, GitService> {
  return Effect.gen(function* () {
    const gitService = yield* GitService;
    const result = yield* gitService.execute({
      operation: "CheckpointStore.test.git",
      cwd,
      args,
      ...(env ? { env } : {}),
      timeoutMs: 10_000,
    });

    return result.stdout.trim();
  });
}

layer("CheckpointStoreLive", (it) => {
  it.effect("returns a bounded summary when checkpoint diff output exceeds the patch limit", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const checkpointStore = yield* CheckpointStore;

      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "checkpoint-store-diff-overflow-",
      });
      const readmePath = path.join(cwd, "README.md");
      const fromCheckpointRef = CheckpointRef.makeUnsafe(
        "refs/t3/checkpoints/thread-overflow/turn-1",
      );
      const toCheckpointRef = CheckpointRef.makeUnsafe(
        "refs/t3/checkpoints/thread-overflow/turn-2",
      );

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["config", "user.name", "T3 Code Test"]);
      yield* git(cwd, ["config", "user.email", "t3code-test@example.com"]);

      yield* fileSystem.writeFileString(readmePath, "base\n");
      yield* git(cwd, ["add", "README.md"]);
      yield* git(cwd, ["commit", "-m", "base"], TEST_COMMIT_ENV);

      yield* checkpointStore.captureCheckpoint({
        cwd,
        checkpointRef: fromCheckpointRef,
      });

      yield* fileSystem.writeFileString(
        readmePath,
        "oversized checkpoint diff line\n".repeat(40_000),
      );

      yield* checkpointStore.captureCheckpoint({
        cwd,
        checkpointRef: toCheckpointRef,
      });

      const diff = yield* checkpointStore.diffCheckpoints({
        cwd,
        fromCheckpointRef,
        toCheckpointRef,
        fallbackFromToHead: false,
      });

      assert.ok(diff.startsWith("Diff too large to render as a patch."));
      assert.ok(diff.includes("Showing a bounded change summary instead."));
      assert.ok(diff.includes("1 file changed"));
      assert.ok(diff.includes("insertions(+)"));
      assert.ok(!diff.includes("Git command failed in CheckpointStore.diffCheckpoints"));
    }),
  );
});
