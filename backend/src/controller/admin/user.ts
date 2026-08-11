import { Request, Response, NextFunction } from "express";
import { authService } from "../../service/auth.service";

export const adminUserController = {
  listUsers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;
      const userList = await authService.listUsers(offset, limit);
      res.status(200).json(userList);
    } catch (error) { next(error);}
  }, 
  changeUserStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.params.userId as string;
      const { status } = req.body as { status: 'active' | 'suspended' | 'pending' | 'banned' };
      await authService.changeUserStatus(userId, status);
      res.status(200).json({ success: true, message: 'User status updated successfully' }); 
    } catch (error) { next(error);}
  },
  softDeleteUser: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.params.userId as string;
      await authService.softDeleteAccount(userId);
      res.status(200).json({ success: true, message: 'User account soft deleted successfully' });
    } catch (error) { next(error); }
  },
  getUserById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.params.userId as string;
      const user = await authService.getUserById(userId);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      res.status(200).json({ success: true, data: user });
    } catch (error) { next(error); }
  },
  getUserByEmail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const email = req.query.email as string;  
      console.log('Email query parameter:', email); // Debugging line
      const user = await authService.getUserByEmail(email);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      res.status(200).json({ success: true, data: user });
    } catch (error) { next(error); }
  }
};