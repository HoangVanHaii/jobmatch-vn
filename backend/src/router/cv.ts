import { Router } from "express";
import { cvController } from "../controller/cv.controller";
import { validateCreateCv } from "../middleware/cv";
import { auth } from "../middleware/auth";

export const cvRouter = Router();

cvRouter.post("/", auth, validateCreateCv, cvController.create);
