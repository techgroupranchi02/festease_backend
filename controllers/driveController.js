'use strict';

const { listImages, getImageStream, getFileMeta } = require('../utils/googleDrive');

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

class DriveController {
  /**
   * GET /api/v1/drive/images
   *
   * Returns a JSON list of all image files in the configured Drive folder.
   * Each item includes a `proxy_url` that points to this backend's proxy
   * endpoint, so the frontend never needs raw Drive links or credentials.
   *
   * Query params:
   *   folder_id  (optional) – override the default folder set in .env
   */
  static async listImages(req, res) {
    try {
      const folderId = req.query.folder_id || FOLDER_ID;

      if (!folderId) {
        return res.status(500).json({
          success: false,
          message: 'GOOGLE_DRIVE_FOLDER_ID is not configured on the server.',
        });
      }

      const files = await listImages(folderId);

      // Build a proxy URL for each file so the frontend can use it directly
      const baseUrl   = process.env.FESTEASE_BACKEND_URL || '';
      const imageList = files.map((f) => ({
        id:            f.id,
        name:          f.name,
        mime_type:     f.mimeType,
        size:          f.size ? parseInt(f.size, 10) : null,
        created_time:  f.createdTime,
        modified_time: f.modifiedTime,
        proxy_url:     `${baseUrl}/api/v1/drive/images/${f.id}`,
      }));

      return res.status(200).json({
        success: true,
        total:   imageList.length,
        data:    imageList,
      });
    } catch (err) {
      console.error('DriveController.listImages error:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to list Drive images.',
        error:   err.message,
      });
    }
  }

  /**
   * GET /api/v1/drive/images/:file_id
   *
   * Proxies/streams a single image file from Google Drive to the client.
   * Sets the correct Content-Type so browsers render it directly (e.g., in
   * an <img> tag or when opened in a new tab).
   *
   * Supports:
   *   - Cache-Control header (1 hour by default)
   *   - Graceful 404 for unknown file IDs
   */
  static async proxyImage(req, res) {
    try {
      const { file_id } = req.params;

      if (!file_id) {
        return res.status(400).json({ success: false, message: 'file_id is required.' });
      }

      // Fetch metadata first to set Content-Type and Content-Disposition
      let meta;
      try {
        meta = await getFileMeta(file_id);
      } catch (metaErr) {
        if (metaErr.code === 404 || (metaErr.errors && metaErr.errors[0]?.reason === 'notFound')) {
          return res.status(404).json({ success: false, message: 'File not found in Drive.' });
        }
        throw metaErr;
      }

      // Only allow image files to be proxied through this endpoint
      if (!meta.mimeType || !meta.mimeType.startsWith('image/')) {
        return res.status(400).json({ success: false, message: 'Requested file is not an image.' });
      }

      // Set response headers
      res.setHeader('Content-Type', meta.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${meta.name}"`);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour browser cache

      if (meta.size) {
        res.setHeader('Content-Length', parseInt(meta.size, 10));
      }

      // Stream the file binary directly to the client
      const imageStream = await getImageStream(file_id);
      imageStream.on('error', (streamErr) => {
        console.error('DriveController.proxyImage stream error:', streamErr.message);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Error streaming image from Drive.' });
        }
      });

      imageStream.pipe(res);
    } catch (err) {
      console.error('DriveController.proxyImage error:', err.message);
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: 'Failed to proxy Drive image.',
          error:   err.message,
        });
      }
    }
  }
}

module.exports = DriveController;
