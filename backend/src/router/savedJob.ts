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
savedJobRouter.post('/', validate(saveJobSchema, 'body'), savedJobController.save);
savedJobRouter.delete('/:jobId', validate(unsaveJobParamsSchema, 'params'), savedJobController.unsave);