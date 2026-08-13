/**
 * Main API router — mount tất cả resources
 */
import { Router } from 'express';
import { authRouter } from './auth';
import { authOauthRouter } from './auth.oauth';
import { userRouter } from './user';
import { candidateRouter } from './candidate';
import { employerRouter } from './employer';
import { companyRouter } from './company';
import { companyMemberRouter } from './companyMember';
import { jobRouter } from './job';
import { jobApplicationRouter } from './jobApplication';
import { resumeRouter } from './resume';
import { messageRouter } from './message';
import { savedJobRouter } from './savedJob';
import { searchRouter } from './search';
import { aiRouter } from './ai';
import { paymentRouter } from './payment';
import { webhooksRouter } from './webhooks';
import { adminRouter } from './admin';
// Phase 2 & 3
import { scanRouter } from './scan';
import { githubRouter } from './github';
import { referenceRouter } from './reference';
import { testRouter } from './test';
import { scheduleRouter } from './schedule';
import { dialogflowRouter } from './dialogflow';
import { notificationRouter } from "./notification";
import { skillsRouter } from "./skills";

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/auth/oauth', authOauthRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/candidates', candidateRouter);
apiRouter.use('/employers', employerRouter);
apiRouter.use('/companies', companyRouter);
apiRouter.use('/companies', companyMemberRouter);
apiRouter.use('/jobs', jobRouter);
apiRouter.use('/applications', jobApplicationRouter);
apiRouter.use('/resumes', resumeRouter);
apiRouter.use('/messages', messageRouter);
apiRouter.use('/saved-jobs', savedJobRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/', paymentRouter);
apiRouter.use('/webhooks', webhooksRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/skills", skillsRouter);
// Phase 2
apiRouter.use('/scan', scanRouter);
apiRouter.use('/github', githubRouter);
apiRouter.use('/references', referenceRouter);
// Phase 3
apiRouter.use('/tests', testRouter);
apiRouter.use('/schedule', scheduleRouter);
apiRouter.use('/dialogflow', dialogflowRouter);