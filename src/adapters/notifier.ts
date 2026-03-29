export interface NotifierAdapter {
  notify(title: string, body: string): Promise<void>;
}

export function createNotifierAdapter(): NotifierAdapter {
  return {
    async notify(title, body) {
      const proc = Bun.spawn(["notify-send", title, body], {
        stdout: "ignore",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        console.error(`notify-send failed (exit ${exitCode}): ${stderr}`);
      }
    },
  };
}
