import { db, nowIso, setSetting } from "./db";
import { Asset, BackupAsset, BackupPayload } from "./types";
import { hasValidationErrors, validateQuestion } from "./validation";

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(",");
  const mimeType = meta.match(/data:(.*?);base64/)?.[1] ?? "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateBackupPayload(payload: unknown): BackupPayload {
  if (!isObject(payload)) throw new Error("バックアップJSONの形式が不正です。");
  if (payload.app !== "icu-mcq-pwa" || payload.schemaVersion !== 1) {
    throw new Error("対応していないバックアップ形式です。");
  }

  const requiredArrays = ["questions", "attempts", "questionStates", "assets", "importJobs", "settings"];
  requiredArrays.forEach((key) => {
    if (!Array.isArray(payload[key])) throw new Error(`${key}が配列ではありません。`);
  });

  const backup = payload as unknown as BackupPayload;
  backup.questions.forEach((question) => {
    const issues = validateQuestion(question);
    const blockingIssues =
      question.status === "active"
        ? issues
        : issues.filter((issue) => !["stem", "choices", "correct_answers"].includes(issue.field));
    if (hasValidationErrors(blockingIssues)) {
      throw new Error(`問題 ${question.id || "(IDなし)"} の形式が不正です。`);
    }
  });

  backup.assets.forEach((asset) => {
    if (!asset.id || !asset.questionId || asset.type !== "image" || !asset.dataUrl.startsWith("data:")) {
      throw new Error("画像データの形式が不正です。");
    }
  });

  return backup;
}

async function exportAssets(assets: Asset[]): Promise<BackupAsset[]> {
  return Promise.all(
    assets.map(async (asset) => ({
      id: asset.id,
      questionId: asset.questionId,
      type: asset.type,
      dataUrl: await blobToDataUrl(asset.blob),
      mimeType: asset.mimeType,
      altText: asset.altText,
      sha256: asset.sha256
    }))
  );
}

export async function createBackupPayload(): Promise<BackupPayload> {
  const [questions, attempts, questionStates, assets, importJobs, settings] = await Promise.all([
    db.questions.toArray(),
    db.attempts.toArray(),
    db.questionStates.toArray(),
    db.assets.toArray(),
    db.importJobs.toArray(),
    db.settings.toArray()
  ]);

  return {
    app: "icu-mcq-pwa",
    schemaVersion: 1,
    exportedAt: nowIso(),
    questions,
    attempts,
    questionStates,
    assets: await exportAssets(assets),
    importJobs,
    settings
  };
}

export async function downloadBackup(): Promise<void> {
  const payload = await createBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `icu-mcq-backup-${payload.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  await setSetting("lastBackupAt", payload.exportedAt);
}

export async function restoreBackupPayload(rawPayload: unknown): Promise<BackupPayload> {
  const payload = validateBackupPayload(rawPayload);

  const assets: Asset[] = payload.assets.map((asset) => ({
    id: asset.id,
    questionId: asset.questionId,
    type: asset.type,
    blob: dataUrlToBlob(asset.dataUrl),
    mimeType: asset.mimeType,
    altText: asset.altText,
    sha256: asset.sha256
  }));

  await db.transaction(
    "rw",
    [db.questions, db.attempts, db.questionStates, db.assets, db.importJobs, db.settings],
    async () => {
      await Promise.all([
        db.questions.clear(),
        db.attempts.clear(),
        db.questionStates.clear(),
        db.assets.clear(),
        db.importJobs.clear(),
        db.settings.clear()
      ]);
      await Promise.all([
        db.questions.bulkPut(payload.questions),
        db.attempts.bulkPut(payload.attempts),
        db.questionStates.bulkPut(payload.questionStates),
        db.assets.bulkPut(assets),
        db.importJobs.bulkPut(payload.importJobs),
        db.settings.bulkPut(payload.settings)
      ]);
    }
  );

  await setSetting("lastRestoreAt", nowIso());
  return payload;
}

export async function restoreBackupFromFile(file: File): Promise<BackupPayload> {
  return restoreBackupPayload(JSON.parse(await file.text()));
}
