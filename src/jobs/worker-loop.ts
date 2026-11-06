/** Cómo arranca, cada cuánto despierta y cuánto espera al apagar un worker. */
export type WorkerLoopOptions = Readonly<{
  autoStart: boolean;
  pollMs: number;
  shutdownMs: number;
}>;

/** Cómo terminó el apagado: si hubo que abortar el trabajo en curso. */
export type WorkerLoopStop = Readonly<{ aborted: boolean }>;

/**
 * El ciclo de vida común de los workers (plan jobs&files, D2): despertar cada
 * `pollMs` o a petición, vaciar la cola sin solapar dos pasadas y, al apagar,
 * esperar al trabajo en curso hasta `shutdownMs` antes de abortarlo.
 *
 * Cada worker aporta su pasada (`pass`), que reclama y procesa trabajos; para
 * cada trabajo pide una señal con `runJob`, que se aborta al apagar.
 */
export class WorkerLoop {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private active?: AbortController;
  private stopping = false;

  constructor(
    private readonly options: WorkerLoopOptions,
    private readonly pass: () => Promise<void>,
    private readonly onPassFailed: () => void,
  ) {}

  start() {
    if (this.options.autoStart) {
      this.timer = setInterval(() => this.wake(), this.options.pollMs);
      this.timer.unref();
      this.wake();
    }
  }

  wake() {
    if (this.options.autoStart) {
      void this.runUntilIdle().catch(() => this.onPassFailed());
    }
  }

  /** Vacía la cola. Si ya se está vaciando, devuelve esa misma ejecución. */
  runUntilIdle(): Promise<void> {
    if (this.stopping) {
      return Promise.resolve();
    }
    this.running ??= this.pass().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /**
   * Una pasada que empieza después de esta llamada. Quien acaba de confirmar
   * trabajo la usa para que se atienda antes de seguir: una pasada ya en curso
   * puede haber mirado la cola antes del commit y terminar sin verlo.
   */
  async runFreshPass(): Promise<void> {
    if (this.running) {
      await this.running.catch(() => undefined);
    }
    return this.runUntilIdle();
  }

  /** La pasada debe dejar de reclamar trabajos: la aplicación se apaga. */
  isStopping() {
    return this.stopping;
  }

  /**
   * Ejecuta un trabajo con su propia señal de aborto. Si el apagado ya empezó,
   * la señal llega abortada: el trabajo no empieza a escribir.
   */
  async runJob<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.active = new AbortController();
    if (this.stopping) {
      this.active.abort();
    }
    try {
      return await work(this.active.signal);
    } finally {
      this.active = undefined;
    }
  }

  /**
   * Deja de despertar y espera a la pasada en curso hasta `shutdownMs`. Si no
   * termina, aborta su trabajo y espera a que la pasada lo registre, para que
   * nada escriba después de cerrar la conexión con la base.
   */
  async stop(): Promise<WorkerLoopStop> {
    this.stopping = true;
    clearInterval(this.timer);
    if (!this.running) {
      return { aborted: false };
    }

    let aborted = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.running,
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            aborted = this.active !== undefined;
            this.active?.abort();
            resolve();
          }, this.options.shutdownMs);
        }),
      ]);
      await this.running;
    } finally {
      clearTimeout(timeout);
    }
    return { aborted };
  }
}
