/**
 * Dialogflow webhook router
 */
import { Router } from 'express';
import { dialogflowService } from '../service/dialogflow.service';

export const dialogflowRouter = Router();

dialogflowRouter.post('/webhook', async (req, res, next) => {
  try {
    const text = await dialogflowService.handleWebhook(req.body.queryResult);
    res.json({ fulfillmentText: text });
  } catch (err) { next(err); }
});