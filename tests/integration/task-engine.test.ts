import "@decaf-ts/core";
import { Adapter } from "@decaf-ts/core";
// Golden rule: the adapter (and its decoration overrides) must load before any
// model module so `Decoration.flavouredAs("drizzle")` overrides are registered
// before the task models are decorated.
import { DrizzleAdapter, DrizzleFlavour } from "../../src";
Adapter.setCurrent(DrizzleFlavour);
DrizzleAdapter.decoration();
import { LogLevel, Logging } from "@decaf-ts/logging";
import { Observer } from "@decaf-ts/core/interfaces";
import {
  CompositeTaskBuilder,
  TaskBackoffModel,
  TaskBuilder,
  TaskContext,
  TaskEngine,
  TaskEventBus,
  TaskEventModel,
  TaskEventType,
  TaskHandler,
  TaskHandlerRegistry,
  TaskLogger,
  TaskModel,
  TaskService,
  TaskStatus,
  TaskType,
  task,
} from "@decaf-ts/core/tasks";
import { sleep } from "@decaf-ts/core";
import { TaskEngineConfig } from "@decaf-ts/core/tasks/types";
import {
  createMysqlAdapter,
  createSqliteAdapter,
  drizzleRepository,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";
import { registerDrizzleOwnershipHandlers } from "../helpers/drizzleTaskSetup";

registerDrizzleOwnershipHandlers();

jest.setTimeout(200000);

const recordedEvents: TaskEventModel[] = [];

const parseNumberInput = (input: unknown): number => {
  if (typeof input === "number") return input;
  if (typeof input === "string") {
    const asNumber = Number(input);
    if (!Number.isNaN(asNumber)) return asNumber;
  }
  if (typeof input === "object" && input !== null) {
    const value = (input as { value?: unknown }).value;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const asNumber = Number(value);
      if (!Number.isNaN(asNumber)) return asNumber;
    }
  }
  throw new Error("invalid task input");
};

@task("drizzle-simple-task")
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class DrizzleSimpleTask extends TaskHandler<
  number | { value: number },
  number
> {
  async run(value: number | { value: number }, ctx: TaskContext) {
    const parsed = parseNumberInput(value);
    ctx.logger.info(`drizzle-simple-task ${parsed}`);
    await ctx.flush();
    return parsed * 3;
  }
}

@task("drizzle-progress-task")
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class DrizzleProgressTask extends TaskHandler<{ value: number }, number> {
  async run(input: { value: number }, ctx: TaskContext) {
    const parsed = parseNumberInput(input);
    ctx.logger.info("drizzle-progress-task: before step 1");
    await ctx.flush();
    await ctx.progress({
      status: TaskStatus.RUNNING,
      currentStep: 1,
      totalSteps: 2,
    });
    ctx.logger.info("drizzle-progress-task: before step 2");
    await ctx.flush();
    await ctx.progress({
      status: TaskStatus.RUNNING,
      currentStep: 2,
      totalSteps: 2,
    });
    ctx.logger.info("drizzle-progress-task: finished");
    await ctx.flush();
    return parsed + 7;
  }
}

@task("drizzle-dynamic-enqueue")
class DrizzleDynamicEnqueueTask extends TaskHandler<
  { seed?: number } | void,
  number
> {
  static runs: Record<string, number> = {};

  async run(input: { seed?: number } | void, ctx: TaskContext) {
    DrizzleDynamicEnqueueTask.runs[ctx.taskId] =
      (DrizzleDynamicEnqueueTask.runs[ctx.taskId] ?? 0) + 1;
    const parsed = parseNumberInput((input as any)?.seed ?? 5);
    await ctx
      .scheduleSteps(
        {
          classification: "drizzle-dynamic-flaky",
        },
        {
          classification: "drizzle-dynamic-tail",
        }
      )
      .afterCurrent(ctx);
    return parsed;
  }
}

@task("drizzle-dynamic-flaky")
class DrizzleDynamicFlakyTask extends TaskHandler<void, number> {
  static runs: Record<string, number> = {};

  async run(_: void, ctx: TaskContext) {
    const run = (DrizzleDynamicFlakyTask.runs[ctx.taskId] ?? 0) + 1;
    DrizzleDynamicFlakyTask.runs[ctx.taskId] = run;
    const cache = ctx.resultCache ?? {};
    const seed = cache[`${ctx.taskId}:step:0`];
    if (typeof seed !== "number") throw new Error("missing seed cache");
    if (run === 1) throw new Error("intentional dynamic flaky failure");
    return seed + 1;
  }
}

@task("drizzle-dynamic-tail")
class DrizzleDynamicTailTask extends TaskHandler<void, number> {
  static runs: Record<string, number> = {};

  async run(_: void, ctx: TaskContext) {
    DrizzleDynamicTailTask.runs[ctx.taskId] =
      (DrizzleDynamicTailTask.runs[ctx.taskId] ?? 0) + 1;
    const cache = ctx.resultCache ?? {};
    const prev = cache[`${ctx.taskId}:step:1`];
    if (typeof prev !== "number") throw new Error("missing flaky cache");
    return prev + 1;
  }
}

@task("drizzle-concurrent-shared-lock-step")
class DrizzleConcurrentSharedLockStep extends TaskHandler<
  { label?: string; delayMs?: number } | void,
  string
> {
  static starts: Record<string, number[]> = {};
  static ends: Record<string, number[]> = {};

  async run(
    input: { label?: string; delayMs?: number } | void,
    ctx: TaskContext
  ) {
    const payload = (input && typeof input === "object" ? input : {}) as {
      label?: string;
      delayMs?: number;
    };
    const label = payload.label ?? `step-${ctx.step}`;
    const delayMs = payload.delayMs ?? 120;
    DrizzleConcurrentSharedLockStep.starts[ctx.taskId] =
      DrizzleConcurrentSharedLockStep.starts[ctx.taskId] ?? [];
    DrizzleConcurrentSharedLockStep.ends[ctx.taskId] =
      DrizzleConcurrentSharedLockStep.ends[ctx.taskId] ?? [];
    DrizzleConcurrentSharedLockStep.starts[ctx.taskId].push(Date.now());
    ctx.logger.info(`drizzle concurrent ${label} start`);
    await ctx.flush();
    await sleep(delayMs);
    ctx.logger.info(`drizzle concurrent ${label} end`);
    await ctx.flush();
    DrizzleConcurrentSharedLockStep.ends[ctx.taskId].push(Date.now());
    return label;
  }
}

@task("drizzle-concurrent-shared-lock-retry-step")
class DrizzleConcurrentSharedRetryLockStep extends TaskHandler<
  { label?: string; delayMs?: number; retryOnce?: boolean } | void,
  string
> {
  static starts: Record<string, number[]> = {};
  static ends: Record<string, number[]> = {};
  static attempts: Record<string, Record<string, number>> = {};

  async run(
    input: { label?: string; delayMs?: number; retryOnce?: boolean } | void,
    ctx: TaskContext
  ) {
    const payload = (input && typeof input === "object" ? input : {}) as {
      label?: string;
      delayMs?: number;
      retryOnce?: boolean;
    };
    const label = payload.label ?? `step-${ctx.step}`;
    const delayMs = payload.delayMs ?? 120;
    const retryOnce = payload.retryOnce ?? false;
    const taskAttempts =
      DrizzleConcurrentSharedRetryLockStep.attempts[ctx.taskId] ?? {};
    const attempt = (taskAttempts[label] ?? 0) + 1;
    taskAttempts[label] = attempt;
    DrizzleConcurrentSharedRetryLockStep.attempts[ctx.taskId] = taskAttempts;

    DrizzleConcurrentSharedRetryLockStep.starts[ctx.taskId] =
      DrizzleConcurrentSharedRetryLockStep.starts[ctx.taskId] ?? [];
    DrizzleConcurrentSharedRetryLockStep.ends[ctx.taskId] =
      DrizzleConcurrentSharedRetryLockStep.ends[ctx.taskId] ?? [];
    DrizzleConcurrentSharedRetryLockStep.starts[ctx.taskId].push(Date.now());
    ctx.logger.info(
      `drizzle retry concurrent ${label} start attempt ${attempt}`
    );
    await ctx.flush();
    await sleep(delayMs);

    if (retryOnce && attempt === 1) {
      ctx.logger.warn(`drizzle retry concurrent ${label} requesting retry`);
      await ctx.flush();
      ctx.retry("intentional retry for concurrent batch stress");
    }

    DrizzleConcurrentSharedRetryLockStep.ends[ctx.taskId].push(Date.now());
    ctx.logger.info(`drizzle retry concurrent ${label} end attempt ${attempt}`);
    await ctx.flush();
    return label;
  }
}

@task("drizzle-concurrent-shared-lock-reschedule-step")
class DrizzleConcurrentSharedRescheduleLockStep extends TaskHandler<
  {
    label?: string;
    delayMs?: number;
    rescheduleOnce?: boolean;
    rescheduleDelayMs?: number;
  } | void,
  string
> {
  static starts: Record<string, number[]> = {};
  static ends: Record<string, number[]> = {};
  static attempts: Record<string, Record<string, number>> = {};

  async run(
    input: {
      label?: string;
      delayMs?: number;
      rescheduleOnce?: boolean;
      rescheduleDelayMs?: number;
    } | void,
    ctx: TaskContext
  ) {
    const payload = (input && typeof input === "object" ? input : {}) as {
      label?: string;
      delayMs?: number;
      rescheduleOnce?: boolean;
      rescheduleDelayMs?: number;
    };
    const label = payload.label ?? `step-${ctx.step}`;
    const delayMs = payload.delayMs ?? 120;
    const rescheduleOnce = payload.rescheduleOnce ?? false;
    const rescheduleDelayMs = payload.rescheduleDelayMs ?? 2000;
    const taskAttempts =
      DrizzleConcurrentSharedRescheduleLockStep.attempts[ctx.taskId] ?? {};
    const attempt = (taskAttempts[label] ?? 0) + 1;
    taskAttempts[label] = attempt;
    DrizzleConcurrentSharedRescheduleLockStep.attempts[ctx.taskId] =
      taskAttempts;

    DrizzleConcurrentSharedRescheduleLockStep.starts[ctx.taskId] =
      DrizzleConcurrentSharedRescheduleLockStep.starts[ctx.taskId] ?? [];
    DrizzleConcurrentSharedRescheduleLockStep.ends[ctx.taskId] =
      DrizzleConcurrentSharedRescheduleLockStep.ends[ctx.taskId] ?? [];
    DrizzleConcurrentSharedRescheduleLockStep.starts[ctx.taskId].push(
      Date.now()
    );
    ctx.logger.info(
      `drizzle reschedule concurrent ${label} start attempt ${attempt}`
    );
    await ctx.flush();
    await sleep(delayMs);

    if (rescheduleOnce && attempt === 1) {
      ctx.logger.warn(
        `drizzle reschedule concurrent ${label} requesting reschedule`
      );
      await ctx.flush();
      ctx.reschedule(
        new Date(Date.now() + rescheduleDelayMs),
        "intentional reschedule for concurrent batch stress"
      );
    }

    DrizzleConcurrentSharedRescheduleLockStep.ends[ctx.taskId].push(Date.now());
    ctx.logger.info(
      `drizzle reschedule concurrent ${label} end attempt ${attempt}`
    );
    await ctx.flush();
    return label;
  }
}

function taskEngineSuite(
  label: string,
  create: () => Promise<DrizzleTestHandle | undefined>
) {
  describe(label, () => {
    const testCase = (
      name: string,
      fn: () => Promise<void> | void,
      timeout?: number
    ) => it(name, fn, timeout ?? 15000);

    let handle: DrizzleTestHandle;
    let taskService: TaskService;
    let engine: TaskEngine<any>;
    let taskRepo: ReturnType<typeof drizzleRepository<TaskModel>>;
    let eventBus: TaskEventBus;
    let registry: TaskHandlerRegistry;
    let unsubscribe: (() => void) | undefined;

    beforeAll(async () => {
      handle = (await create()) as DrizzleTestHandle;
      await handle.adapter.index(TaskModel, TaskEventModel);
      // The MySQL handle is created inside `create()`, which queues behind the
      // shared cross-suite lock; the hook timeout must cover that wait.

      eventBus = new TaskEventBus();
      registry = new TaskHandlerRegistry();

      const config: TaskEngineConfig<any> = {
        adapter: handle.adapter,
        bus: eventBus,
        registry,
        workerId: "drizzle-integration-worker",
        concurrency: 1,
        leaseMs: 500,
        pollMsIdle: 1000,
        pollMsBusy: 200,
        logTailMax: 5000,
        streamBufferSize: 5,
        maxLoggingBuffer: 100,
        loggingBufferTruncation: 10,
        gracefulShutdownMsTimeout: 4000,
        maxConcurrentCompositeSteps: 2,
      };

      taskService = new TaskService();
      await taskService.boot(config);
      engine = taskService.client as TaskEngine<any>;
      await engine.start();

      taskRepo = drizzleRepository(handle.adapter, TaskModel);

      const observer: Observer = {
        async refresh(evt: TaskEventModel) {
          if (evt?.taskId) {
            recordedEvents.push(evt);
          }
        },
      };
      unsubscribe = eventBus.observe(observer);
    }, MYSQL_TEST_TIMEOUT_MS);

    beforeEach(() => {
      recordedEvents.length = 0;
    });

    afterAll(async () => {
      unsubscribe?.();
      await taskService.shutdown();
      await handle.cleanup();
    });

    const eventsFor = (taskId: string, type?: TaskEventType) =>
      recordedEvents.filter(
        (evt) =>
          evt && evt.taskId === taskId && (!type || evt.classification === type)
      );

    const waitForTaskStatus = async (
      id: string,
      status: TaskStatus,
      timeout = 30000
    ) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const task = await taskRepo.read(id);
        if (task.status === status) return task;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Task ${id} did not reach ${status} within ${timeout}ms`);
    };

    testCase("executes a task and logs status events", async () => {
      const toSubmit = new TaskBuilder()
        .setClassification("drizzle-simple-task")
        .setInput({ value: 6 })
        .build();

      const { task, tracker } = await engine.push(toSubmit, true);
      const output = await tracker.resolve();

      expect(output).toBe(18);

      const persisted = await taskRepo.read(task.id);
      expect(persisted.status).toBe(TaskStatus.SUCCEEDED);
      expect(persisted.output).toBe(18);

      const statusEvents = eventsFor(task.id, TaskEventType.STATUS);
      const statusValues = statusEvents.map((evt) => evt.payload?.status);
      expect(statusValues).toEqual(
        expect.arrayContaining([TaskStatus.RUNNING, TaskStatus.SUCCEEDED])
      );
    });

    testCase(
      "pipes status and progress events through the tracker",
      async () => {
        const capturedStatuses: TaskStatus[] = [];
        const progressPayloads: TaskEventModel[] = [];

        const composite = new TaskBuilder()
          .setClassification("drizzle-progress-task")
          .setInput({ value: 3 })
          .build();

        const { tracker } = await engine.push(composite, true);

        tracker.pipe((evt) => {
          const status = evt.payload?.status ?? evt.payload;
          if (typeof status === "string") {
            capturedStatuses.push(status as TaskStatus);
          }
        }, TaskEventType.STATUS);

        tracker.pipe((evt) => {
          progressPayloads.push(evt);
        }, TaskEventType.PROGRESS);

        const output = await tracker.resolve();
        expect(output).toBe(10);

        expect(capturedStatuses).toContain(TaskStatus.SUCCEEDED);
        expect(progressPayloads.length).toBeGreaterThanOrEqual(2);
        expect(progressPayloads[0].payload).toMatchObject({
          currentStep: 1,
          totalSteps: 2,
        });
      }
    );

    testCase(
      "records task events via the TaskEventModel repository",
      async () => {
        const eventRepo = drizzleRepository(handle.adapter, TaskEventModel);
        const composite = new TaskBuilder()
          .setClassification("drizzle-progress-task")
          .setInput({ value: 2 })
          .build();

        const { task, tracker } = await engine.push(composite, true);
        await tracker.resolve();

        const allEvents = await eventRepo.select().execute();
        const taskEvents = allEvents.filter((evt) => evt.taskId === task.id);

        expect(taskEvents.length).toBeGreaterThan(0);
        expect(
          taskEvents.some((evt) => evt.classification === TaskEventType.STATUS)
        ).toBe(true);
        expect(
          taskEvents.some((evt) => evt.classification === TaskEventType.LOG)
        ).toBe(true);

        const statusPayloads = taskEvents
          .filter((evt) => evt.classification === TaskEventType.STATUS)
          .map((evt) => {
            const payload = evt.payload;
            if (!payload) return undefined;
            if (typeof payload === "string") {
              try {
                return JSON.parse(payload);
              } catch {
                return undefined;
              }
            }
            return payload;
          })
          .map((payload) => (payload as any)?.status);
        expect(statusPayloads).toContain(TaskStatus.SUCCEEDED);
      }
    );

    testCase("attaches a custom logger and flushes raw logs", async () => {
      const baseLogger = Logging.get().for("drizzle-task-engine");
      const infoSpy = jest.spyOn(baseLogger, "info");
      const logger = new TaskLogger(baseLogger, 5, 10);
      const rawMessages: string[] = [];

      const toSubmit = new TaskBuilder()
        .setClassification("drizzle-progress-task")
        .setInput({ value: 1 })
        .build();

      const { tracker } = await engine.push(toSubmit, true);
      tracker.pipe((evt) => {
        if (evt.classification !== TaskEventType.LOG) return;
        const logs = evt.payload as Array<{
          level: LogLevel;
          msg: string;
          meta: unknown;
        }>;

        evt.payload = logs.map(({ level, msg, meta }) => [level, msg, meta]);
      });
      tracker.attach(logger, {
        logProgress: true,
        logStatus: true,
        style: false,
      });

      tracker.logs((logs) => {
        rawMessages.push(
          ...logs.map(
            (entry: [unknown, string | undefined, unknown]) =>
              `${entry[1] ?? ""}`
          )
        );
      });

      try {
        await tracker.resolve();

        expect(
          rawMessages.some((msg) => msg.includes("drizzle-progress-task"))
        ).toBe(true);
        const infoCalls = infoSpy.mock.calls.map((call) => `${call[0] ?? ""}`);
        expect(infoCalls.some((call) => call.includes("### STATUS"))).toBe(
          true
        );
        expect(infoCalls.some((call) => call.includes("### STEP"))).toBe(true);
      } finally {
        infoSpy.mockRestore();
      }
    });

    testCase(
      "persists dynamically added steps across retry and emits tracker update events",
      async () => {
        DrizzleDynamicEnqueueTask.runs = {};
        DrizzleDynamicFlakyTask.runs = {};
        DrizzleDynamicTailTask.runs = {};

        const updateEvents: TaskEventModel[] = [];
        const task = new CompositeTaskBuilder()
          .setClassification("drizzle-dynamic-chain")
          .setMaxAttempts(2)
          .addStep("drizzle-dynamic-enqueue", { seed: 7 })
          .build();

        const { task: pushed, tracker } = await engine.push(task, true);
        tracker.onUpdate(async (evt) => {
          updateEvents.push(evt);
        });

        const waitingRetry = await waitForTaskStatus(
          pushed.id,
          TaskStatus.WAITING_RETRY
        );
        expect(waitingRetry.currentStep).toBe(1);
        expect(waitingRetry.steps?.map((step) => step.classification)).toEqual([
          "drizzle-dynamic-enqueue",
          "drizzle-dynamic-flaky",
          "drizzle-dynamic-tail",
        ]);

        const output = await tracker.resolve();
        expect(output.stepResults.length).toBe(3);
        expect(output.stepResults[0].output).toBe(7);
        expect(output.stepResults[1].output).toBe(8);
        expect(output.stepResults[2].output).toBe(9);

        expect(DrizzleDynamicEnqueueTask.runs[pushed.id]).toBe(1);
        expect(DrizzleDynamicFlakyTask.runs[pushed.id]).toBe(2);
        expect(DrizzleDynamicTailTask.runs[pushed.id]).toBe(1);
        expect(updateEvents.length).toBeGreaterThan(0);
        expect(updateEvents[0].classification).toBe(TaskEventType.UPDATE);
      }
    );

    testCase(
      "keeps concurrent locked step logs and outputs intact",
      async () => {
        DrizzleConcurrentSharedLockStep.starts = {};
        DrizzleConcurrentSharedLockStep.ends = {};

        const composite = new CompositeTaskBuilder({
          classification: "drizzle-concurrent-shared-lock",
          atomicity: TaskType.COMPOSITE,
          attempt: 0,
          maxAttempts: 1,
        })
          .addStep("drizzle-concurrent-shared-lock-step")
          .setInput({ label: "alpha", delayMs: 120 })
          .setLock("drizzle-shared-concurrent")
          .setAllowConcurrent(true)
          .build()
          .addStep("drizzle-concurrent-shared-lock-step")
          .setInput({ label: "beta", delayMs: 120 })
          .setLock("drizzle-shared-concurrent")
          .setAllowConcurrent(true)
          .build()
          .build();

        const startedAt = Date.now();
        const { task, tracker } = await engine.push(composite, true);
        const result = await tracker.resolve();
        const elapsed = Date.now() - startedAt;

        expect(result.stepResults).toHaveLength(2);
        expect(result.stepResults.map((step) => step.output)).toEqual([
          "alpha",
          "beta",
        ]);
        expect(DrizzleConcurrentSharedLockStep.starts[task.id]).toHaveLength(2);
        expect(DrizzleConcurrentSharedLockStep.ends[task.id]).toHaveLength(2);
        expect(DrizzleConcurrentSharedLockStep.starts[task.id][1]).toBeLessThan(
          DrizzleConcurrentSharedLockStep.ends[task.id][0]
        );
        expect(elapsed).toBeLessThan(8000);

        const persisted = await taskRepo.read(task.id);
        expect(persisted.stepResults?.map((step) => step.output)).toEqual([
          "alpha",
          "beta",
        ]);
        expect(
          persisted.logTail?.filter((entry) =>
            entry.msg.includes("drizzle concurrent")
          ).length
        ).toBeGreaterThanOrEqual(4);
        expect(
          persisted.logTail?.every(
            (entry) =>
              entry.step === 0 || entry.step === 1 || entry.step === undefined
          )
        ).toBe(true);
      }
    );

    testCase(
      "runs three concurrent batches and preserves all outputs and logs",
      async () => {
        DrizzleConcurrentSharedLockStep.starts = {};
        DrizzleConcurrentSharedLockStep.ends = {};

        const batchSizes = [3, 5, 7] as const;
        const labels: string[] = [];
        const compositeBuilder = new CompositeTaskBuilder({
          classification: "drizzle-concurrent-shared-lock-batches",
          atomicity: TaskType.COMPOSITE,
          attempt: 0,
          maxAttempts: 1,
        });

        batchSizes.forEach((size, batchIndex) => {
          const lock = `drizzle-shared-concurrent-batch-${batchIndex + 1}`;
          for (let index = 0; index < size; index += 1) {
            const label = `batch-${batchIndex + 1}-${index + 1}`;
            labels.push(label);
            compositeBuilder
              .addStep("drizzle-concurrent-shared-lock-step")
              .setInput({ label, delayMs: 120 })
              .setLock(lock)
              .setAllowConcurrent(true)
              .build();
          }
        });

        const composite = compositeBuilder.build();
        const { task, tracker } = await engine.push(composite, true);
        const result = await tracker.resolve();

        expect(result.stepResults).toHaveLength(labels.length);
        expect(result.stepResults.map((step) => step.output)).toEqual(labels);

        const starts = DrizzleConcurrentSharedLockStep.starts[task.id];
        const ends = DrizzleConcurrentSharedLockStep.ends[task.id];
        expect(starts).toHaveLength(labels.length);
        expect(ends).toHaveLength(labels.length);

        let offset = 0;
        batchSizes.forEach((size) => {
          const batchStarts = starts.slice(offset, offset + size);
          const batchEnds = ends.slice(offset, offset + size);
          expect(batchStarts).toHaveLength(size);
          expect(batchEnds).toHaveLength(size);
          expect(batchStarts[1]).toBeLessThan(batchEnds[0]);
          offset += size;
        });

        const persisted = await taskRepo.read(task.id);
        expect(persisted.stepResults?.map((step) => step.output)).toEqual(
          labels
        );

        const concurrentLogs =
          persisted.logTail?.filter((entry) =>
            entry.msg.startsWith("drizzle concurrent batch-")
          ) ?? [];
        expect(concurrentLogs).toHaveLength(labels.length * 2);
        for (const label of labels) {
          expect(
            concurrentLogs.some((entry) =>
              entry.msg.includes(`drizzle concurrent ${label} start`)
            )
          ).toBe(true);
          expect(
            concurrentLogs.some((entry) =>
              entry.msg.includes(`drizzle concurrent ${label} end`)
            )
          ).toBe(true);
        }
      },
      60000
    );

    testCase(
      "retries one step across concurrent batches without dropping logs or results",
      async () => {
        DrizzleConcurrentSharedRetryLockStep.starts = {};
        DrizzleConcurrentSharedRetryLockStep.ends = {};
        DrizzleConcurrentSharedRetryLockStep.attempts = {};

        const batchSizes = [3, 5, 7] as const;
        const labels: string[] = [];
        const retryLabel = "batch-2-5";
        const compositeBuilder = new CompositeTaskBuilder({
          classification: "drizzle-concurrent-shared-lock-retry-batches",
          atomicity: TaskType.COMPOSITE,
          attempt: 0,
          maxAttempts: 2,
        });

        batchSizes.forEach((size, batchIndex) => {
          const lock = `drizzle-shared-concurrent-retry-batch-${batchIndex + 1}`;
          for (let index = 0; index < size; index += 1) {
            const label = `batch-${batchIndex + 1}-${index + 1}`;
            labels.push(label);
            compositeBuilder
              .addStep("drizzle-concurrent-shared-lock-retry-step")
              .setInput({
                label,
                delayMs: 100,
                retryOnce: label === retryLabel,
              })
              .setLock(lock)
              .setAllowConcurrent(true)
              .build();
          }
        });

        const composite = compositeBuilder.build();
        const { task, tracker } = await engine.push(composite, true);
        const result = await tracker.resolve();

        expect(result.stepResults).toHaveLength(labels.length);
        expect(result.stepResults.map((step) => step.output)).toEqual(labels);

        const attempts = DrizzleConcurrentSharedRetryLockStep.attempts[task.id];
        expect(attempts).toBeDefined();
        expect(attempts?.[retryLabel]).toBe(2);
        for (const label of labels) {
          if (label !== retryLabel) {
            expect(attempts?.[label]).toBe(1);
          }
        }

        const persisted = await taskRepo.read(task.id);
        expect(persisted.stepResults?.map((step) => step.output)).toEqual(
          labels
        );

        const logs = persisted.logTail ?? [];
        expect(
          logs.some((entry) =>
            entry.msg.includes(
              `drizzle retry concurrent ${retryLabel} start attempt 1`
            )
          )
        ).toBe(true);
        expect(
          logs.some((entry) =>
            entry.msg.includes(
              `drizzle retry concurrent ${retryLabel} requesting retry`
            )
          )
        ).toBe(true);
        expect(
          logs.some((entry) =>
            entry.msg.includes(
              `drizzle retry concurrent ${retryLabel} start attempt 2`
            )
          )
        ).toBe(true);
        expect(
          logs.some((entry) =>
            entry.msg.includes(
              `drizzle retry concurrent ${retryLabel} end attempt 2`
            )
          )
        ).toBe(true);
      },
      90000
    );

    testCase(
      "reschedules one step across concurrent batches without dropping logs or results",
      async () => {
        DrizzleConcurrentSharedRescheduleLockStep.starts = {};
        DrizzleConcurrentSharedRescheduleLockStep.ends = {};
        DrizzleConcurrentSharedRescheduleLockStep.attempts = {};

        const batchSizes = [3, 5, 7] as const;
        const labels: string[] = [];
        const rescheduleLabel = "batch-2-5";
        const compositeBuilder = new CompositeTaskBuilder({
          classification: "drizzle-concurrent-shared-lock-reschedule-batches",
          atomicity: TaskType.COMPOSITE,
          attempt: 0,
          maxAttempts: 2,
        });

        batchSizes.forEach((size, batchIndex) => {
          const lock = `drizzle-shared-concurrent-reschedule-batch-${batchIndex + 1}`;
          for (let index = 0; index < size; index += 1) {
            const label = `batch-${batchIndex + 1}-${index + 1}`;
            labels.push(label);
            compositeBuilder
              .addStep("drizzle-concurrent-shared-lock-reschedule-step")
              .setInput({
                label,
                delayMs: 100,
                rescheduleOnce: label === rescheduleLabel,
                rescheduleDelayMs: 2000,
              })
              .setLock(lock)
              .setAllowConcurrent(true)
              .build();
          }
        });

        const composite = compositeBuilder.build();
        const { task, tracker } = await engine.push(composite, true);

        const scheduledTask = await waitForTaskStatus(
          task.id,
          TaskStatus.SCHEDULED
        );
        expect(scheduledTask.status).toBe(TaskStatus.SCHEDULED);

        const result = await tracker.wait();
        expect(result.stepResults).toHaveLength(labels.length);
        expect(result.stepResults.map((step) => step.output)).toEqual(labels);

        const attempts =
          DrizzleConcurrentSharedRescheduleLockStep.attempts[task.id];
        expect(attempts).toBeDefined();
        expect(attempts?.[rescheduleLabel]).toBe(2);
        for (const label of labels) {
          if (label !== rescheduleLabel) {
            expect(attempts?.[label]).toBe(1);
          }
        }

        const persisted = await taskRepo.read(task.id);
        expect(persisted.status).toBe(TaskStatus.SUCCEEDED);
        expect(persisted.stepResults?.map((step) => step.output)).toEqual(
          labels
        );

        const logs = persisted.logTail ?? [];
        expect(
          logs.some((entry) =>
            entry.msg.includes(
              `drizzle reschedule concurrent ${rescheduleLabel} start attempt 1`
            )
          )
        ).toBe(true);
        expect(
          logs.some((entry) =>
            entry.msg.includes(
              `drizzle reschedule concurrent ${rescheduleLabel} requesting reschedule`
            )
          )
        ).toBe(true);
        expect(
          logs.some((entry) =>
            entry.msg.includes(
              `drizzle reschedule concurrent ${rescheduleLabel} start attempt 2`
            )
          )
        ).toBe(true);
        expect(
          logs.some((entry) =>
            entry.msg.includes(
              `drizzle reschedule concurrent ${rescheduleLabel} end attempt 2`
            )
          )
        ).toBe(true);
      },
      90000
    );
  });
}

taskEngineSuite("drizzle task engine (sqlite)", () => createSqliteAdapter());
if (hasMysql()) {
  taskEngineSuite("drizzle task engine (mysql)", () => createMysqlAdapter());

  describe("drizzle task engine (mysql) object-column regression", () => {
    it(
      "object columns persist beyond VARCHAR(255) on MySQL",
      async () => {
        // Regression for SAA-1556: `src/schema/translation.ts` resolves
        // object/array properties to the structured `object` column type, which
        // `src/indexes/generator.ts` now renders as `JSON` on MySQL (previously
        // `VARCHAR(255)`). The task engine stores `logTail`/`steps`/`stepResults`
        // as JSON objects, so a non-trivial task must persist without
        // ER_DATA_TOO_LONG under STRICT_TRANS_TABLES.
        const handle = (await createMysqlAdapter()) as DrizzleTestHandle;
        try {
          await handle.adapter.index(TaskModel, TaskEventModel);
          const repo = drizzleRepository(handle.adapter, TaskModel);
          const created = await repo.create(
            new TaskModel({
              classification: "object-column-defect",
              name: "object-column-defect",
              maxAttempts: 1,
              backoff: new TaskBackoffModel(),
            } as any)
          );
          created.logTail = [
            {
              ts: new Date(),
              level: "info",
              msg: "x".repeat(600),
            } as any,
          ];
          await repo.update(created);
        } finally {
          await handle.cleanup();
        }
      },
      MYSQL_TEST_TIMEOUT_MS
    );
  });
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql task engine not exercised"
  );
}
