import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Check, CheckName, HealthRun } from '../types'

const PANE = 'project-health'
const TITLE = 'Здоровье проекта'
const COMMAND = 'health'

/** The checks, in the order they run; each is one npm script of the project. */
const CHECKS: ReadonlyArray<{ name: CheckName; label: string; argv: readonly string[] }> = [
  { name: 'typecheck', label: 'tsc', argv: ['npm', 'run', '-s', 'typecheck'] },
  { name: 'lint', label: 'eslint', argv: ['npm', 'run', '-s', 'lint'] },
  { name: 'test', label: 'tests', argv: ['npm', 'test', '-s'] },
]

/** Files whose edit makes the checks worth running again. */
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/
const IGNORED = /(^|\/)(node_modules|\.next|dist|coverage)\//

const LINES_PER_FAIL = 6
const CHECK_TIMEOUT_MS = 180_000

// Bump the tag when a Check's fields change: it declines what an earlier
// version stored, which outlives a reload.
const checks = atom({ plugin: 'project-health', key: 'checks' } as const, initialChecks(), {
  shape: 'checks-1',
})
const dirty = atom({ plugin: 'project-health', key: 'dirty' } as const, [])
const run = atom({ plugin: 'project-health', key: 'run' } as const, null)

function initialChecks(): Check[] {
  return CHECKS.map(({ name }) => ({
    name,
    status: 'never',
    durationMs: null,
    lines: [],
    finishedAt: null,
  }))
}

function labelOf(name: CheckName): string {
  return CHECKS.find(c => c.name === name)?.label ?? name
}

function glyph(check: Check): string {
  switch (check.status) {
    case 'ok':
      return '✓'
    case 'fail':
      return '✗'
    case 'error':
      return '!'
    case 'running':
      return '…'
    default:
      return '·'
  }
}

function colorOf(check: Check): 'success' | 'error' | 'warning' | 'subtle' {
  switch (check.status) {
    case 'ok':
      return 'success'
    case 'fail':
      return 'error'
    case 'error':
      return 'warning'
    default:
      return 'subtle'
  }
}

function seconds(ms: number | null): string {
  return ms === null ? '' : `${(ms / 1000).toFixed(1)}s`
}

function ago(from: number | null, now: number): string {
  if (from === null) return 'ещё не запускалось'
  const s = Math.max(0, Math.round((now - from) / 1000))
  if (s < 60) return `${s}с назад`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}м назад`
  return `${Math.round(m / 60)}ч назад`
}

/** The lines worth showing from a failing command: errors first, noise out. */
function pickLines(stdout: string, stderr: string): string[] {
  const all = `${stdout}\n${stderr}`
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '' && !/^npm (notice|warn|ERR!)/.test(l) && !/^\s+at /.test(l))
  const errors = all.filter(l => /error|fail|✖|not ok|TS\d{4}/i.test(l))
  const picked = (errors.length > 0 ? errors : all).slice(0, LINES_PER_FAIL)
  const more = (errors.length > 0 ? errors : all).length - picked.length
  return more > 0 ? [...picked, `… ещё ${more}`] : picked
}

function summary(list: Check[]): string {
  return list.map(c => `${glyph(c)} ${labelOf(c.name)}`).join('  ')
}

let isRunning = false
let shouldRerun = false

/** Runs every check in order, writes each result as it lands, and reports. */
async function runAll($: EngineInterface, trigger: HealthRun['trigger']): Promise<Check[]> {
  if (isRunning) {
    shouldRerun = true
    return read($, checks)
  }
  isRunning = true
  try {
    const cwd = await $.session.cwd()
    const before = await read($, checks)
    const wasGreen = before.every(c => c.status === 'ok')

    const startedAt = await $.clock.now()
    await update($, run, () => ({ trigger, startedAt }))
    await update($, dirty, () => [])
    await update($, checks, list => list.map(c => ({ ...c, status: 'running' as const })))
    $.ui.status(`health: запускаю ${CHECKS.map(c => c.label).join(', ')}…`)

    for (const spec of CHECKS) {
      const startedAt = await $.clock.now()
      let next: Check
      try {
        const ran = await $.process.run(spec.argv, { cwd, timeoutMs: CHECK_TIMEOUT_MS })
        const finishedAt = await $.clock.now()
        next = {
          name: spec.name,
          status: ran.exitCode === 0 ? 'ok' : 'fail',
          durationMs: finishedAt - startedAt,
          lines: ran.exitCode === 0 ? [] : pickLines(ran.stdout, ran.stderr),
          finishedAt,
        }
      } catch (error) {
        const finishedAt = await $.clock.now()
        next = {
          name: spec.name,
          status: 'error',
          durationMs: finishedAt - startedAt,
          lines: [String(error instanceof Error ? error.message : error).slice(0, 200)],
          finishedAt,
        }
      }
      await update($, checks, list => list.map(c => (c.name === spec.name ? next : c)))
      $.ui.status(`health: ${summary(await read($, checks))}`)
    }

    const after = await read($, checks)
    const failed = after.filter(c => c.status !== 'ok')
    $.ui.status(`health: ${summary(after)}`)
    if (failed.length > 0) {
      $.ui.toast(`Проект сломан: ${failed.map(c => labelOf(c.name)).join(', ')}`, {
        timeoutMs: 6000,
      })
    } else if (!wasGreen) {
      $.ui.toast('Проект снова зелёный: tsc, eslint и тесты прошли')
    }
    await update($, run, () => null)
    return after
  } finally {
    isRunning = false
    if (shouldRerun) {
      shouldRerun = false
      void runAll($, 'edit')
    }
  }
}

function report(list: Check[]): string {
  const rows = list.map(c => {
    const head = `${glyph(c)} ${labelOf(c.name)} ${seconds(c.durationMs)}`.trimEnd()
    return c.lines.length === 0 ? head : `${head}\n${c.lines.map(l => `    ${l}`).join('\n')}`
  })
  return `Здоровье проекта\n${rows.join('\n')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Запустить typecheck, lint и тесты проекта и показать панель',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  // A command of the mod's own: no next, so it answers for itself.
  on('command.run', { command: COMMAND }, async ($, e) => {
    await $.ui.open({ id: PANE, title: TITLE })
    if (e.args.trim() === 'open') {
      return { text: 'Панель здоровья проекта открыта.' }
    }
    const list = await runAll($, 'command')
    return { text: report(list) }
  })

  // Every edit of a source file marks the project dirty; the checks run when
  // the turn ends, so one turn of many edits pays for one run.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const isEdit = tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' || tool === 'MultiEdit'
    const path =
      isEdit && 'file_path' in e && typeof e.file_path === 'string'
        ? e.file_path
        : isEdit && 'notebook_path' in e && typeof e.notebook_path === 'string'
          ? e.notebook_path
          : null
    const ran = await next(e)
    if (path === null || ran.deny !== undefined || ran.isError === true) return ran
    if (!SOURCE.test(path) || IGNORED.test(path)) return ran

    const cwd = await $.session.cwd()
    if (!path.startsWith(cwd)) return ran
    const rel = path.slice(cwd.length).replace(/^\//, '')
    await update($, dirty, list => (list.includes(rel) ? list : [...list, rel]))
    $.ui.status(`health: изменено ${(await read($, dirty)).length} файл(ов), проверю в конце хода`)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && (await read($, dirty)).length > 0) {
      void runAll($, 'edit')
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, checks)
    const pending = await read($, dirty)
    const current = await read($, run)
    const now = await $.clock.now()
    const lastAt = list.reduce<number | null>(
      (acc, c) => (c.finishedAt !== null && (acc === null || c.finishedAt > acc) ? c.finishedAt : acc),
      null,
    )
    const rows = e.viewport?.rows ?? 24
    const narrow = e.props.bodyColumns < 40

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            {current !== null
              ? `идёт проверка (${current.trigger === 'command' ? '/health' : 'после правок'})`
              : pending.length > 0
                ? `${pending.length} файл(ов) изменено, запуск в конце хода`
                : `последняя проверка: ${ago(lastAt, now)}`}
          </Text>
          <Button key="run" hotkey="r" dimColor onPress={() => void runAll($, 'press')}>
            {current !== null ? 'идёт…' : 'r: запустить'}
          </Button>
        </Box>

        {list.map(c => (
          <Box key={c.name} flexDirection="column">
            <Text>
              <Text color={colorOf(c)} bold>
                {glyph(c)}
              </Text>{' '}
              <Text bold>{labelOf(c.name)}</Text>{' '}
              <Text dimColor>
                {c.status === 'running' ? 'выполняется' : c.status === 'never' ? 'не запускалось' : seconds(c.durationMs)}
              </Text>
            </Text>
            {rows > 12 &&
              c.lines.slice(0, narrow ? 3 : LINES_PER_FAIL + 1).map(line => (
                <Text color={colorOf(c)} dimColor wrap="truncate-end">
                  {'  '}
                  {line}
                </Text>
              ))}
          </Box>
        ))}

        {pending.length > 0 && rows > 16 && (
          <Box flexDirection="column">
            <Text dimColor>Изменено:</Text>
            {pending.slice(-5).map(file => (
              <Text dimColor wrap="truncate-start">
                {'  '}
                {file}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
