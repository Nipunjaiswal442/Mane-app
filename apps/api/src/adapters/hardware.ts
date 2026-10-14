import { cpus, totalmem } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { product } from '@mane/product-config';
export interface Hardware {
  inspect(): Promise<{ cpuCores: number; ramGb: number; gpu: null | { name: string; vramGb: number } }>;
}
export class CpuHardware implements Hardware {
  async inspect() {
    return { cpuCores: cpus().length, ramGb: Math.round(totalmem() / 1024 ** 3), gpu: null };
  }
}
export class NvidiaHardware implements Hardware {
  async inspect() {
    const base = await new CpuHardware().inspect();
    try {
      const { stdout } = await promisify(execFile)(
        'nvidia-smi',
        ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
        { timeout: 5000 },
      );
      const [name, memory] = stdout.trim().split('\n')[0]!.split(',');
      return { ...base, gpu: { name: name!.trim(), vramGb: Math.round(Number(memory) / 1024) } };
    } catch {
      return base;
    }
  }
}
export async function hardwareStatus() {
  const detected = await (
    process.env.HARDWARE_BACKEND === 'nvidia' ? new NvidiaHardware() : new CpuHardware()
  ).inspect();
  const p = product.tiers.production;
  const meetsProduction =
    !!detected.gpu &&
    detected.cpuCores >= p.min_cores &&
    detected.ramGb >= p.min_ram_gb &&
    detected.gpu.vramGb >= p.min_vram_gb;
  return { ...detected, tier: meetsProduction ? 'Production' : 'Pilot', requirements: product.tiers };
}
