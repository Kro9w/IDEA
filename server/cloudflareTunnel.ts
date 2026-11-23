import { spawn, type ChildProcess } from 'node:child_process'

let tunnelProcess: ChildProcess | null = null
let tunnelUrl: string | null = null
let tunnelStarting: Promise<string> | null = null

function tunnelTarget(webPort?: number): string {
  if (process.env.IDEA_TUNNEL_TARGET) return process.env.IDEA_TUNNEL_TARGET
  if (process.env.NODE_ENV === 'production') {
    return `http://127.0.0.1:${process.env.PORT ?? '3001'}`
  }
  return `http://127.0.0.1:${webPort ?? 5173}`
}

export function getCloudflareTunnelStatus(): { running: boolean; url: string | null } {
  const running = tunnelProcess !== null && tunnelProcess.exitCode === null && tunnelUrl !== null
  return { running, url: running ? tunnelUrl : null }
}

export function startCloudflareTunnel(webPort?: number): Promise<string> {
  const status = getCloudflareTunnelStatus()
  if (status.running && status.url) return Promise.resolve(status.url)
  if (tunnelStarting) return tunnelStarting

  tunnelStarting = new Promise<string>((resolve, reject) => {
    const executable = process.env.CLOUDFLARED_PATH ?? 'cloudflared'
    const child = spawn(executable, ['tunnel', '--url', tunnelTarget(webPort), '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    tunnelProcess = child

    let output = ''
    let settled = false
    const timeout = setTimeout(() => {
      fail(new Error('Timed out waiting for Cloudflare to create a tunnel. Check your internet connection and try again.'))
    }, 30_000)

    function fail(error: Error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      tunnelUrl = null
      if (tunnelProcess === child) tunnelProcess = null
      child.kill()
      reject(error)
    }

    function readOutput(chunk: Buffer) {
      output = `${output}${chunk.toString()}`.slice(-16_384)
      const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0]
      if (url && !settled) {
        settled = true
        clearTimeout(timeout)
        tunnelUrl = url
        resolve(url)
      }
    }

    child.stdout?.on('data', readOutput)
    child.stderr?.on('data', readOutput)
    child.once('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'ENOENT'
        ? 'cloudflared is not installed or could not be found. Install Cloudflare Tunnel and restart IDEA.'
        : `Could not start cloudflared: ${error.message}`
      fail(new Error(message))
    })
    child.once('exit', (code, signal) => {
      if (tunnelProcess === child) {
        tunnelProcess = null
        tunnelUrl = null
      }
      if (!settled) {
        const detail = output.trim().split('\n').filter(Boolean).slice(-1)[0]
        fail(new Error(detail || `Cloudflare tunnel exited before it was ready (${signal ?? code ?? 'unknown'}).`))
      }
    })
  }).finally(() => {
    tunnelStarting = null
  })

  return tunnelStarting
}

export async function stopCloudflareTunnel(): Promise<void> {
  const child = tunnelProcess
  tunnelProcess = null
  tunnelUrl = null
  if (!child || child.exitCode !== null) return

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill('SIGTERM')
  })
}
