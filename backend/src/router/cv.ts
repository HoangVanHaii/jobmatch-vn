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
import { cvAiRateLimiter, cvWriteRateLimiter } from "../middleware/rateLimit";

export const cvRouter = Router();

cvRouter.use(auth, candidateOnly);

cvRouter.post("/upload", auth, cvAiRateLimiter, validateCreateCv, cvController.upload);

cvRouter.get("/", auth, validateListCvQuery, cvController.list);

cvRouter.get("/:cvId", auth, validateCvIdParam, cvController.getDetail);

cvRouter.post("/direct", auth, cvAiRateLimiter, validateCreateDirectCv, cvController.create);

cvRouter.patch("/:cvId/primary", auth, validateCvIdParam, cvController.setPrimary);

cvRouter.post("/:cvId/analyze", auth, cvAiRateLimiter, validateCvIdParam, cvController.triggerAnalysis);

cvRouter.patch("/:cvId", auth, cvWriteRateLimiter, cvAiRateLimiter, validateCvIdParam, validateUpdateDirectCv, cvController.update);

cvRouter.delete("/:cvId", auth, cvWriteRateLimiter, validateCvIdParam, cvController.remove)