import { Router } from 'express';
import { auth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  savedJobListQuerySchema,
  saveJobSchema,
  unsaveJobParamsSchema,
} from '../middleware/savedJob';
import { savedJobController } from '../controller/saveJob.controller';

export const savedJobRouter = Router();
savedJobRouter.use(auth);

savedJobRouter.get('/', validate(savedJobListQuerySchema, 'query'), savedJobController.list);
/** GET /saved-jobs/ids — chỉ trả jobId[] (nhẹ, dùng cho bookmark icon check). */
savedJobRouter.get('/ids', savedJobController.listIds);
savedJobRouter.post('/', validate(saveJobSchema, 'body'), savedJobController.save);
savedJobRouter.delete('/:jobId', validate(unsaveJobParamsSchema, 'params'), savedJobController.unsave);