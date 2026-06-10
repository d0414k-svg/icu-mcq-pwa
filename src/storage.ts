export interface StorageStatus {
  supported: boolean;
  persisted?: boolean;
  requested?: boolean;
  usage?: number;
  quota?: number;
}

export async function requestPersistentStorage(): Promise<StorageStatus> {
  if (!("storage" in navigator)) return { supported: false };

  const estimate = await navigator.storage.estimate?.();
  const persistedBefore = await navigator.storage.persisted?.();
  const requested = persistedBefore ? true : await navigator.storage.persist?.();
  const persistedAfter = await navigator.storage.persisted?.();

  return {
    supported: true,
    persisted: Boolean(persistedAfter ?? persistedBefore),
    requested: Boolean(requested),
    usage: estimate?.usage,
    quota: estimate?.quota
  };
}
