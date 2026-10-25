import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { agentCommand } from '@lengmoxxl/sdk';
import type { Network } from '@lengmoxxl/sdk/bridge';

const exec = promisify(execFile);
// The agent this Core drives: a release of its own, so a Core update brings a new one without an app release.
const VERSION = '0.1.18';
// Where the releases live: each one is under the tag of its own version.
const RELEASES = 'https://github.com/lengmoXXL/WangCai/releases/download';
// A download that stalls fails instead of holding the connect up for good; curl counts it in seconds.
const DOWNLOAD_TIMEOUT = 30;
const DOWNLOAD_ATTEMPTS = 2;
const TARGETS: Record<string, string> = {
  'Darwin x86_64': 'x86_64-apple-darwin',
  'Darwin arm64': 'aarch64-apple-darwin',
  'Linux x86_64': 'x86_64-unknown-linux-musl',
};
// The same release, named by what the machine Core runs on reports of itself.
const LOCAL_TARGETS: Record<string, string> = {
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
};

/** The agent this Core drives: the one its own machine runs, and what installs it on the machines it reaches. */
export interface Agents {
  /** Where this machine's agent is: downloaded under the data directory when it is not there yet. */
  local(): Promise<string>;
  /** The install the SDK asks for before it connects over ssh. */
  ssh(host: string, signal?: AbortSignal): Promise<void>;
}

/**
 * The agent release this Core drives, on the machine it runs on and on the ones it reaches over ssh. A build
 * from a development checkout is used as it stands, so a run of the shell does not fetch what it just built.
 */
export function agentInstaller(storage: string, network: Network): Agents {
  const path = join(storage, 'bin/wangcai');
  let installed: string | undefined;
  async function installLocal() {
    const source = process.env.WANGCAI_AGENT_SOURCE;
    if (source) return source;
    if (await reports(path)) return path;
    const target = LOCAL_TARGETS[`${process.platform}-${process.arch}`];
    if (!target) throw new Error(`${process.platform} ${process.arch} 上暂不支持安装 agent`);
    const binary = await fetchRelease(target, network);
    mkdirSync(dirname(path), { recursive: true });
    const written = `${path}.tmp`;
    writeFileSync(written, binary);
    chmodSync(written, 0o755);
    renameSync(written, path);
    return path;
  }

  return {
    local: async () => installed ??= await installLocal(),
    async ssh(host, signal) {
      const remote = (command: string) => ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, agentCommand(command)];
      // A machine that refuses the probe keeps whatever it has: its own start command reports the real failure.
      const probe = await exec('ssh', remote('uname -s -m; wangcai --version 2>/dev/null; true'), { timeout: 30_000, signal }).catch(() => undefined);
      const [platform, current] = (probe?.stdout ?? '').split('\n').map((line) => line.trim());
      if (!platform) return;
      const target = TARGETS[platform];
      if (!target) throw new Error(`${platform} 上暂不支持自动安装 agent`);
      if (current === `wangcai ${VERSION}`) return;
      const binary = await fetchRelease(target, network, signal);
      await new Promise<void>((resolve, reject) => {
        const command = 'mkdir -p ~/.local/bin && cat > ~/.local/bin/.wangcai.tmp && chmod 755 ~/.local/bin/.wangcai.tmp && mv ~/.local/bin/.wangcai.tmp ~/.local/bin/wangcai';
        const child = spawn('ssh', remote(command), { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `写入 agent 失败（ssh 退出码 ${code}）`)));
        child.stdin.end(binary);
      });
    },
  };
}

/** One platform's release, which the digest published beside it has to agree with. */
async function fetchRelease(target: string, network: Network, signal?: AbortSignal) {
  const release = `${RELEASES}/agent-v${VERSION}/wangcai-${target}`;
  const url = network.mirror ? `${network.mirror}${release}` : release;
  // GitHub's release edge now and then answers an asset with 400 and serves it on the next call, so one failure is
  // not yet a machine that cannot be set up.
  for (let attempt = 1; ; attempt++) {
    try {
      const expected = await publishedDigest(`${url}.sha256`, network, signal);
      const binary = await download(url, network, signal);
      const digest = createHash('sha256').update(binary).digest('hex');
      if (digest !== expected) throw new Error(`sha256 不符：期望 ${expected}，得到 ${digest}`);
      return binary;
    } catch (error) {
      // A cancel is not a download failure: the connect that asked for this was aborted.
      signal?.throwIfAborted();
      const failure = `下载 agent 失败：${url}\n${error instanceof Error ? error.message : String(error)}`;
      if (attempt === DOWNLOAD_ATTEMPTS) throw new Error(failure);
      console.error(`${failure}\n再试一次`);
    }
  }
}

function curl(url: string, network: Network, output: string, signal?: AbortSignal) {
  // A socks5 name resolved here is one the proxy cannot correct: curl takes it in its remote-DNS form, as the shell
  // hands it to git and npm.
  const proxy = network.proxy ? ['--proxy', network.proxy.replace(/^socks5:\/\//, 'socks5h://')] : [];
  const args = ['--fail', '--silent', '--show-error', '--location', '--max-time', String(DOWNLOAD_TIMEOUT), '--output', output, ...proxy, url];
  // exec's message leads with the command it ran; curl's own line is what says why it failed.
  return exec('curl', args, { signal }).catch((error: Error & { stderr?: string }) => {
    throw new Error(error.stderr?.trim() || error.message);
  });
}

// The asset lands in a file first, since curl's output comes back as text.
async function download(url: string, network: Network, signal?: AbortSignal) {
  const directory = mkdtempSync(join(tmpdir(), 'wangcai-agent-'));
  try {
    const file = join(directory, 'asset');
    await curl(url, network, file, signal);
    return readFileSync(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Every asset is published beside its digest, from the same prefix: what a mirror answers for one has to agree with
// the other, so an error page or a half file never reaches the machine.
async function publishedDigest(url: string, network: Network, signal?: AbortSignal) {
  const digest = (await curl(url, network, '-', signal)).stdout.trim();
  if (!/^[0-9a-f]{64}$/i.test(digest)) throw new Error(`发布目录里的校验值不是 sha256：${digest.slice(0, 80)}`);
  return digest.toLowerCase();
}

/** Whether the agent at `path` is the release this Core drives. */
async function reports(path: string) {
  const { stdout } = await exec(path, ['--version']).catch(() => ({ stdout: '' }));
  return stdout.trim() === `wangcai ${VERSION}`;
}