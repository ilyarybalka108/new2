export type CheckName = 'typecheck' | 'lint' | 'test'

export type CheckStatus = 'never' | 'running' | 'ok' | 'fail' | 'error'

export type Check = {
  name: CheckName
  status: CheckStatus
  /** How long the last run took, in milliseconds; null before the first run. */
  durationMs: number | null
  /** The first lines of what the failing command printed, trimmed; [] when ok. */
  lines: string[]
  /** When the last run ended, milliseconds since the epoch; null before the first run. */
  finishedAt: number | null
}

export type HealthRun = {
  /** What started the run: a code edit at the turn's end, or the /health command. */
  trigger: 'edit' | 'command' | 'press'
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'project-health': {
      checks: Shaped<Check[]>
      /** Files changed since the last run, repo-relative; [] when the last run is current. */
      dirty: string[]
      run: HealthRun | null
    }
  }
}
