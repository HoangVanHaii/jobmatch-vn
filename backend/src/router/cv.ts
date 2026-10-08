import { Router } from "express";
import { cvController } from "../controller/cv.controller";

import {
  validateCreateCv,
  validateCreateDirectCv,
  validateUpdateDirectCv,
  validateCvIdParam,
  validateListCvQuery,
} from "../middleware/cv";
import { auth, candidateOnly } from "../middleware/auth";
import { cvAiRateLimiter, cvDownloadRateLimiter, cvWriteRateLimiter } from "../middleware/rateLimit";

export const cvRouter = Router();

cvRouter.get("/:cvId/render-data", cvController.getRenderData);

// download-pdf ĐẶT TRƯỚC `use(auth, candidateOnly)` — employer cũng tải được
// PDF CV direct (CV nằm trong application mình own). Controller tự authorize:
// candidate = self, employer/admin = ownership qua application → jobs.
cvRouter.get("/:cvId/download-pdf", auth, cvDownloadRateLimiter, validateCvIdParam, cvController.downloadPdf);

cvRouter.use(auth, candidateOnly);

cvRouter.post("/upload", auth, cvAiRateLimiter, validateCreateCv, cvController.upload);

cvRouter.get("/", auth, validateListCvQuery, cvController.list);

cvRouter.get("/:cvId", auth, validateCvIdParam, cvController.getDetail);

cvRouter.post("/direct", auth, cvAiRateLimiter, validateCreateDirectCv, cvController.create);

cvRouter.patch("/:cvId/primary", auth, validateCvIdParam, cvController.setPrimary);

cvRouter.post("/:cvId/analyze", auth, cvAiRateLimiter, validateCvIdParam, cvController.triggerAnalysis);

cvRouter.patch("/:cvId", auth, cvWriteRateLimiter, cvAiRateLimiter, validateCvIdParam, validateUpdateDirectCv, cvController.update);

cvRouter.delete("/:cvId", auth, cvWriteRateLimiter, validateCvIdParam, cvController.remove)