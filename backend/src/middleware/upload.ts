/**
 * Multer upload middleware — PDF/DOCX only, size limit
 */
import multer from 'multer';
import { AppError } from './errorHandler';

const ALLOWED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'image/jpeg',
  'image/png',
];

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new AppError(400, 'INVALID_FILE_TYPE', `File type ${file.mimetype} not allowed`));
    }
    cb(null, true);
  },
});