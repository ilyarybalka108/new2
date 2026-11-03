import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'project-health',
  component: 'Pane',
  requestId: 'project-health',
  props: {
    title: 'Здоровье проекта',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('before any run the pane lists the three checks as never run', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'health' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /tsc/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /eslint/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tests/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ещё не запускалось/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/health runs the three scripts and reports each verdict', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'health' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  const ran: string[] = []
  on('process.run', (_, e) => {
    ran.push(e.argv.join(' '))
    const isLint = e.argv.includes('lint')
    return {
      value: {
        exitCode: isLint ? 1 : 0,
        stdout: isLint ? 'src/a.ts\n  1:1  error  Unexpected any  no-explicit-any\n' : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({
    command: 'health',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  expect(ran).toEqual(['npm run -s typecheck', 'npm run -s lint', 'npm test -s'])
  expect(out.text).toContain('✓ tsc')
  expect(out.text).toContain('✗ eslint')
  expect(out.text).toContain('Unexpected any')
  expect(out.text).toContain('✓ tests')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Unexpected any/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an edit of a source file marks it dirty and the turn end runs the checks', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'health' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))
  let runs = 0
  on('process.run', () => {
    runs += 1
    return {
      value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/lib/links.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/node_modules/x/index.js', content: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /1 файл\(ов\) изменено/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /src\/lib\/links\.ts/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)
  expect(runs).toBe(3)
})
