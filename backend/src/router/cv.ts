import { Router } from "express";
import { cvController } from "../controller/cv.controller";

import {
  validateCreateCv,
  validateCreateDirectCv,
  validateCvIdParam,
  validateListCvQuery,
} from "../middleware/cv";
import { auth, candidateOnly } from "../middleware/auth";

export const cvRouter = Router();

cvRouter.use(auth, candidateOnly);

// Upload CV (file đã lên MinIO, client gửi URL + mime về đây) — tạo row với source='upload'.
cvRouter.post("/upload", auth, validateCreateCv, cvController.upload);

// List CVs của candidate đang đăng nhập (ẩn status='deleted').
// Query: ?source=upload|direct — optional filter.
cvRouter.get("/", auth, validateListCvQuery, cvController.list);

// GET /cvs/:cvId — chi tiết 1 CV (full row, kể cả parsedData + aiScore).
cvRouter.get("/:cvId", auth, validateCvIdParam, cvController.getDetail);

// Tạo CV trực tiếp qua form web — tạo row với source='direct', templateId bắt buộc (1-5).
cvRouter.post("/direct", auth, validateCreateDirectCv, cvController.create);

// Đặt CV này là primary (transaction reset các CV khác về isPrimary=false).
cvRouter.patch("/:cvId/primary", auth, validateCvIdParam, cvController.setPrimary);

cvRouter.delete("/:cvId", auth, validateCvIdParam, cvController.remove)