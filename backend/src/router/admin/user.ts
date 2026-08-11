import { Router } from "express";
import { adminUserController } from "../../controller/admin/user";
import { auth } from "../../middleware/auth";
import { adminRateLimiter } from "../../middleware/rateLimit";

export const adminUserRouter = Router();

adminUserRouter.use(auth);
adminUserRouter.use(adminRateLimiter);

adminUserRouter.get("/email", adminUserController.getUserByEmail);
adminUserRouter.get("/", adminUserController.listUsers);
adminUserRouter.get("/:userId", adminUserController.getUserById);
adminUserRouter.patch("/:userId/status", adminUserController.changeUserStatus);
adminUserRouter.delete("/:userId", adminUserController.softDeleteUser);