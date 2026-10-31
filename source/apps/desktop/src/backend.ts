export interface FsInfo { dir: string; file: string; size: number; backups: { name: string; size: number; mtime: number }[] }
export interface FsApi {
  load(): Promise<string | null>; save(t: string): Promise<void>; saveSync(t: string): boolean;
  info(): Promise<FsInfo>; openDir(): Promise<void>; chooseDir(): Promise<{ info: FsInfo; reload: boolean } | null>;
  backupNow(): Promise<FsInfo>; readBackup(name: string): Promise<string>;
  exportDialog(text: string, name: string): Promise<string | null>; importDialog(): Promise<{ name: string; b64: string } | null>;
}
const KEY = "recall.v1";
/** Есть только в приложении (.exe): настоящие файлы на диске. В браузере — localStorage. */
export const fsApi: FsApi | undefined = (window as unknown as { recallFS?: FsApi }).recallFS;

export const backend = {
  load: async (): Promise<string | null> => (fsApi ? fsApi.load() : localStorage.getItem(KEY)),
  save: async (text: string): Promise<void> => { if (fsApi) await fsApi.save(text); else localStorage.setItem(KEY, text); },
  saveSync: (text: string): void => { if (fsApi) fsApi.saveSync(text); else localStorage.setItem(KEY, text); },
};
