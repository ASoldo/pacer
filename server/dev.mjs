import { spawn } from 'node:child_process'

const children = [
  spawn('npm', ['run', 'dev:tts'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit' }),
]

const stop = () => {
  children.forEach((child) => {
    if (!child.killed) child.kill('SIGTERM')
  })
}

process.on('SIGINT', () => {
  stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  stop()
  process.exit(0)
})

children.forEach((child) => {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      stop()
      process.exit(code)
    }
  })
})
