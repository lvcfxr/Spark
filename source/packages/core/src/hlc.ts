/**
 * Hybrid Logical Clock. Строка вида "<wall:15>-<counter:5>-<deviceId>" сравнивается
 * лексикографически и даёт полный порядок на всех устройствах (deviceId разрывает ничьи).
 * Устойчив к сдвигу часов: receive() подтягивает локальные часы к самым "новым" из виденных.
 */
export interface HlcParts { wall: number; counter: number; deviceId: string }

export function formatHlc(p: HlcParts): string {
  return `${String(p.wall).padStart(15, "0")}-${String(p.counter).padStart(5, "0")}-${p.deviceId}`;
}

export function parseHlc(s: string): HlcParts {
  const [wall, counter, ...rest] = s.split("-");
  return { wall: Number(wall), counter: Number(counter), deviceId: rest.join("-") };
}

export class HlcClock {
  private wall = 0;
  private counter = 0;
  constructor(readonly deviceId: string, private now: () => number = Date.now) {}

  /** Метка для локального события. */
  tick(): string {
    const phys = this.now();
    if (phys > this.wall) { this.wall = phys; this.counter = 0; } else { this.counter++; }
    return formatHlc({ wall: this.wall, counter: this.counter, deviceId: this.deviceId });
  }

  /** Вызывать для каждой полученной удалённой метки. */
  receive(remote: string): void {
    const r = parseHlc(remote);
    const phys = this.now();
    const wall = Math.max(this.wall, r.wall, phys);
    if (wall === this.wall && wall === r.wall) this.counter = Math.max(this.counter, r.counter) + 1;
    else if (wall === this.wall) this.counter++;
    else if (wall === r.wall) this.counter = r.counter + 1;
    else this.counter = 0;
    this.wall = wall;
  }
}
