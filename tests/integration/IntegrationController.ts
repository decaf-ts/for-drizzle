import { exec } from "child_process";

/**
 * Drives the MySQL integration service used by live dialect tests. Jest is not
 * configured with a global setup hook in this package, so this controller is a
 * parity artifact: it is kept ready for a CI-driven lifecycle but is inert unless
 * wired into `jest.config.cjs`.
 */
export class IntegrationController {
  private static controller = new AbortController();

  private constructor() {}

  private static run(command: string, env?: Record<string, any>, cwd?: string) {
    const { signal } = this.controller;
    return exec(
      command,
      {
        encoding: "utf8",
        cwd: cwd || process.cwd(),
        signal,
        env: Object.assign({}, process.env, env || {}),
      },
      (err, stdout, stderr) => {
        if (stdout) console.log(`[${command}] ` + stdout);
        if (stderr) console.error(`[${command}] ` + stderr);
        if (err) console.error(`[${command}] Interrupted with ` + stderr);
      }
    );
  }

  static async setupDatabase() {
    return new Promise<void>((resolve, reject) => {
      const proc = this.run("npm run docker:up", process.env, process.cwd());
      proc.on("exit", (code) => {
        if (code !== 0) return reject("Error in MySQL setup: " + code);
        console.log("MySQL setup");
        return resolve();
      });
    });
  }

  static async dropDatabase() {
    const proc = this.run("npm run docker:down", process.env, process.cwd());
    proc.on("exit", (code) => {
      if (code === 0) return console.log("MySQL dropped");
      console.log("Error in MySQL drop: " + code);
    });
  }
}
