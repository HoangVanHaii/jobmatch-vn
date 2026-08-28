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
import { planRouter } from './plan';
import { paymentRouter } from './payment';
import { subscriptionRouter } from './subscription';
import { webhooksRouter } from './webhooks';
import { adminRouter } from './admin';
// Phase 2 & 3
import { githubRouter } from './github';
import { referenceRouter } from './reference';
import { scheduleRouter } from './schedule';
import { dialogflowRouter } from './dialogflow';
import { notificationRouter } from "./notification";
import { skillsRouter } from "./skills";
import { cvRouter } from './cv';
import { candidateSkillRouter } from './candidateSkill';
import { uploadRouter } from './upload';

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
apiRouter.use('/plans', planRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/subscriptions', subscriptionRouter);
apiRouter.use('/webhooks', webhooksRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/skills", skillsRouter);
apiRouter.use("/cvs", cvRouter)
apiRouter.use("/uploads", uploadRouter);
apiRouter.use("/skills", candidateSkillRouter);
// Phase 2
apiRouter.use('/github', githubRouter);
apiRouter.use('/references', referenceRouter);
// Phase 3
apiRouter.use('/schedule', scheduleRouter);
apiRouter.use('/dialogflow', dialogflowRouter);