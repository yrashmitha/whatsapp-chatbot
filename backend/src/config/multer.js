/**
 * @module config/multer
 * @description Multer upload middleware instances:
 *  - upload     : memory storage, max 5 MB (product images via Cloudinary)
 *  - uploadDisk : disk storage to UPLOADS_DIR, images only, max 10 MB
 *  - uploadMedia: disk storage to UPLOADS_DIR, images/PDF/audio, max 16 MB
 */

'use strict';

const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');
const { UPLOADS_DIR } = require('./env');

// Ensure the uploads directory exists at startup
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}
}

/**
 * In-memory upload for small images piped directly to Cloudinary.
 * @type {multer.Multer}
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * Disk-storage upload that saves images to the persistent UPLOADS_DIR.
 * @type {multer.Multer}
 */
const uploadDisk = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
      const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image\/|application\/pdf)/.test(file.mimetype)),
});

/**
 * Disk-storage upload for CRM media send: images, PDFs, and audio up to 16 MB.
 * @type {multer.Multer}
 */
const uploadMedia = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^(image\/|application\/pdf|audio\/)/.test(file.mimetype));
  },
});

/**
 * Voice-clip upload: audio, plus video containers (mp4 / mov / m4a often carry
 * only an audio track and report a video/* or octet-stream mime). ffmpeg strips
 * any video and transcodes to ogg/opus afterwards.
 * @type {multer.Multer}
 */
const uploadVoiceClip = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(audio\/|video\/(mp4|webm|ogg|quicktime|3gpp|x-m4a)|application\/octet-stream)/.test(file.mimetype)
      || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|amr|mp4|mov|3gp|webm)$/i.test(file.originalname || '');
    cb(null, ok);
  },
});

module.exports = { upload, uploadDisk, uploadMedia, uploadVoiceClip };
