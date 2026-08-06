'use strict';

const path        = require('path');
const { google }  = require('googleapis');

// ─── Auth ────────────────────────────────────────────────────────────────────
const SCOPES      = ['https://www.googleapis.com/auth/drive.readonly'];
const KEY_PATH    = path.join(__dirname, '../keys/google-service-account.json');

let _driveClient = null;

/**
 * Returns a singleton Google Drive v3 client authenticated as the
 * service account.
 */
function getDriveClient() {
  if (_driveClient) return _driveClient;

  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes:  SCOPES,
  });

  _driveClient = google.drive({ version: 'v3', auth });
  return _driveClient;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * List all image files inside a Drive folder.
 *
 * @param {string} folderId  - Google Drive folder ID
 * @param {string} [pageToken]
 * @returns {Promise<Array<{id, name, mimeType, size, createdTime, modifiedTime}>>}
 */
async function listImages(folderId, pageToken = undefined) {
  const drive = getDriveClient();

  const allFiles = [];
  let   nextPageToken = pageToken;

  do {
    const res = await drive.files.list({
      q:        `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields:   'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)',
      pageSize: 100,
      orderBy:  'name',
      ...(nextPageToken ? { pageToken: nextPageToken } : {}),
    });

    const files = res.data.files || [];
    allFiles.push(...files);
    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);

  return allFiles;
}

/**
 * Get a readable stream for a Drive file's binary content.
 * Caller is responsible for piping / consuming the stream.
 *
 * @param {string} fileId
 * @returns {Promise<import('stream').Readable>}
 */
async function getImageStream(fileId) {
  const drive = getDriveClient();

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return res.data;
}

async function getFileMeta(fileId) {
  const drive = getDriveClient();

  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size',
  });

  return res.data;
}

// ─── Cache Management ────────────────────────────────────────────────────────
const _driveCache = new Map(); // folderId -> { timestamp, fileMap, files }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

/**
 * Get a Map of (qr_data -> Drive file_id) cached in memory.
 * Refreshes automatically every 5 minutes or when forced.
 *
 * @param {string} folderId
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<Map<string, string>>}
 */
async function getDriveFileMap(folderId, forceRefresh = false) {
  const now = Date.now();
  const cached = _driveCache.get(folderId);

  if (!forceRefresh && cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.fileMap;
  }

  const files = await listImages(folderId);
  const fileMap = new Map();
  for (const f of files) {
    const key = f.name.replace(/\.[^.]+$/, '');
    fileMap.set(key, f.id);
  }

  _driveCache.set(folderId, {
    timestamp: now,
    fileMap,
    files
  });

  return fileMap;
}

module.exports = { listImages, getImageStream, getFileMeta, getDriveFileMap };
