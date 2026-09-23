import { interviews, interviewerAvailability } from '../db/schema/interview';

export type Interview = typeof interviews.$inferSelect;
export type NewInterview = typeof interviews.$inferInsert;

export type InterviewerAvailability = typeof interviewerAvailability.$inferSelect;
export type NewInterviewerAvailability = typeof interviewerAvailability.$inferInsert;

export interface CandidateInterviewRow {
  interviewId: string;
  applicationId: string;
  jobId: string;
  jobTitle: string | null;
  companyName: string | null;
  scheduledAt: Date;
  durationMin: number | null;
  location: string | null;
  meetingLink: string | null;
  status: string | null;
}

export interface EmployerInterviewRow {
  id: string;
  applicationId: string;
  jobId: string | null;
  jobTitle: string | null;
  candidateId: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  interviewerId: string;
  scheduledAt: Date;
  durationMin: number | null;
  location: string | null;
  meetingLink: string | null;
  status: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}

export interface InterviewDetail extends EmployerInterviewRow {
  cancelReason: string | null;
  cancelledAt: Date | null;
  feedback: {
    scores: Record<string, number>;
    comments: string;
    recommendation: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire';
  } | null;
  feedbackSubmittedAt: Date | null;
}

