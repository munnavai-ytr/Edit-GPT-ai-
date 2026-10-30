import {openDB, DBSchema, IDBPDatabase} from 'idb';
import {AppSettings, MediaAssetMeta, ProjectRecord} from './types';

interface StoredMediaBlob {
  assetId: string;
  projectId: string;
  blob: Blob;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

interface StoredRenderedVideo {
  projectId: string;
  blob: Blob;
  sizeBytes: number;
  updatedAt: number;
}

interface ShortsEditorDB extends DBSchema {
  projects: {
    key: string;
    value: ProjectRecord;
    indexes: {'by-updated': number};
  };
  media_blobs: {
    key: string;
    value: StoredMediaBlob;
    indexes: {'by-project': string};
  };
  rendered_videos: {
    key: string;
    value: StoredRenderedVideo;
  };
}

const DB_NAME = 'ai-shorts-editor-v1';
const DB_VERSION = 1;
const SETTINGS_KEY = 'ai-shorts-editor-settings-v1';

let dbPromise: Promise<IDBPDatabase<ShortsEditorDB>> | null = null;

function getDB(): Promise<IDBPDatabase<ShortsEditorDB>> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is only available in the browser.'));
  }
  if (!dbPromise) {
    dbPromise = openDB<ShortsEditorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', {keyPath: 'id'});
          projectStore.createIndex('by-updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('media_blobs')) {
          const mediaStore = db.createObjectStore('media_blobs', {
            keyPath: 'assetId',
          });
          mediaStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('rendered_videos')) {
          db.createObjectStore('rendered_videos', {keyPath: 'projectId'});
        }
      },
    });
  }
  return dbPromise;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('projects', 'by-updated');
  return all.reverse();
}

export async function getProject(projectId: string): Promise<ProjectRecord | undefined> {
  const db = await getDB();
  return db.get('projects', projectId);
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  const db = await getDB();
  project.updatedAt = Date.now();
  await db.put('projects', project);
}

export async function saveMediaAssetBlob(
  meta: MediaAssetMeta,
  blob: Blob
): Promise<void> {
  const db = await getDB();
  await db.put('media_blobs', {
    assetId: meta.id,
    projectId: meta.projectId,
    blob,
    name: meta.name,
    mimeType: meta.mimeType,
    sizeBytes: blob.size,
    createdAt: meta.createdAt,
  });
}

export async function getMediaAssetBlob(assetId: string): Promise<Blob | undefined> {
  const db = await getDB();
  const entry = await db.get('media_blobs', assetId);
  return entry?.blob;
}

export async function getProjectMediaBlobs(
  projectId: string
): Promise<Map<string, Blob>> {
  const db = await getDB();
  const entries = await db.getAllFromIndex('media_blobs', 'by-project', projectId);
  const map = new Map<string, Blob>();
  for (const item of entries) {
    map.set(item.assetId, item.blob);
  }
  return map;
}

export async function saveRenderedVideo(
  projectId: string,
  blob: Blob
): Promise<void> {
  const db = await getDB();
  await db.put('rendered_videos', {
    projectId,
    blob,
    sizeBytes: blob.size,
    updatedAt: Date.now(),
  });
}

export async function getRenderedVideo(projectId: string): Promise<Blob | undefined> {
  const db = await getDB();
  const rec = await db.get('rendered_videos', projectId);
  return rec?.blob;
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'media_blobs', 'rendered_videos'], 'readwrite');
  await tx.objectStore('projects').delete(projectId);
  await tx.objectStore('rendered_videos').delete(projectId);

  const mediaIndex = tx.objectStore('media_blobs').index('by-project');
  let cursor = await mediaIndex.openCursor(projectId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function clearAllStorage(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'media_blobs', 'rendered_videos'], 'readwrite');
  await tx.objectStore('projects').clear();
  await tx.objectStore('media_blobs').clear();
  await tx.objectStore('rendered_videos').clear();
  await tx.done;
}

export async function getStorageSummary(): Promise<{
  projectCount: number;
  mediaBytes: number;
  renderedBytes: number;
  totalBytes: number;
  quotaBytes?: number;
}> {
  const db = await getDB();
  const projects = await db.count('projects');
  const mediaAll = await db.getAll('media_blobs');
  const renderedAll = await db.getAll('rendered_videos');

  const mediaBytes = mediaAll.reduce((acc, m) => acc + (m.sizeBytes || 0), 0);
  const renderedBytes = renderedAll.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);

  let quotaBytes: number | undefined;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      quotaBytes = est.quota;
    } catch {
      // Ignore quota estimation errors
    }
  }

  return {
    projectCount: projects,
    mediaBytes,
    renderedBytes,
    totalBytes: mediaBytes + renderedBytes,
    quotaBytes,
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  directorModel: 'gemini-3.8-flash',
  transcriptionModel: 'gemini-3.5-transcribe',
  defaultResolution: '1080p',
  defaultRenderMode: 'local',
  autoLowMemoryFallback: true,
};

export function loadAppSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_APP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      directorModel:
        typeof parsed.directorModel === 'string' && parsed.directorModel.trim()
          ? parsed.directorModel.trim()
          : 'gemini-3.8-flash',
      transcriptionModel:
        typeof parsed.transcriptionModel === 'string' &&
        parsed.transcriptionModel.trim()
          ? parsed.transcriptionModel.trim()
          : 'gemini-3.5-transcribe',
      defaultResolution: parsed.defaultResolution === '720p' ? '720p' : '1080p',
      defaultRenderMode:
        parsed.defaultRenderMode === 'cloud' ? 'cloud' : 'local',
      autoLowMemoryFallback:
        typeof parsed.autoLowMemoryFallback === 'boolean'
          ? parsed.autoLowMemoryFallback
          : true,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write errors
  }
}

export function detectDeviceMemoryGB(): number | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & {deviceMemory?: number};
  return typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
}
