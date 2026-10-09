/**
 * AI test API client — employer (generate/review/assign) + public candidate
 * (làm bài qua /test/:token). Pattern giống reference.api.ts.
 */
import { http } from './http';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export type AiTestType = 'iq' | 'english';

export interface AiTestSummary {
  id: string;
  testType: AiTestType;
  level: string | null;
  status: 'generating' | 'ready' | 'failed';
  totalPoints: number | null;
  durationMin: number | null;
  questionCount: number;
  createdAt: string;
}

export interface AiTestQuestion {
  id: string;
  type: string;
  question: string;
  options?: string[];
  correctAnswer?: string;
  points: number;
}

export interface AiTestDetail {
  id: string;
  jobId: string;
  testType: AiTestType;
  level: string | null;
  status: 'generating' | 'ready' | 'failed';
  questions: AiTestQuestion[] | null;
  totalPoints: number | null;
  durationMin: number | null;
  passingScore: string | null;
  createdAt: string;
}

export interface TestAssignmentRow {
  id: string;
  testId: string;
  testType: AiTestType;
  testStatus: string;
  status: string;
  score: string | null;
  sentAt: string | null;
  submittedAt: string | null;
  expiresAt: string | null;
  flags: string[] | null;
}

export interface GenerateResult {
  testId: string;
  status: string;
  reused: boolean;
}

export interface AssignResult {
  assignmentId: string;
  status: string;
  expiresAt: string;
}

/** Public — đề cho candidate (đã strip đáp án + shuffle). */
export interface PublicTest {
  testType: AiTestType;
  durationMin: number | null;
  totalPoints: number | null;
  startedAt: string;
  questions: Array<{
    id: string;
    order: number;
    type: string;
    question: string;
    options?: string[];
    points: number;
  }>;
}

export interface SubmitResult {
  score: number;
  totalPoints: number;
  passed: boolean;
}

export interface AssignmentDetail {
  assignment: {
    id: string;
    applicationId: string;
    testId: string;
    status: string;
    answers: Record<string, string> | null;
    score: string | null;
    feedback: Record<string, unknown> | null;
    sentAt: string | null;
    startedAt: string | null;
    submittedAt: string | null;
    gradedAt: string | null;
    expiresAt: string | null;
    ipAddress: string | null;
    flags: string[] | null;
  };
  test: {
    id: string;
    testType: AiTestType;
    questions: AiTestQuestion[] | null;
    totalPoints: number | null;
    durationMin: number | null;
    passingScore: string | null;
  };
}

/** Candidate view — assignment của chính mình (không kèm đáp án). */
export interface MyAssignmentRow {
  id: string;
  testType: AiTestType;
  status: string;
  score: string | null;
  passingScore: string | null;
  sentAt: string | null;
  submittedAt: string | null;
  expiresAt: string | null;
}

export const aiTestApi = {
  /** GET /ai-tests/my/application/:applicationId — candidate xem test của mình. */
  listMyAssignments: (applicationId: string) =>
    http.get<ApiResponse<MyAssignmentRow[]>>(`/ai-tests/my/application/${applicationId}`),

  /** POST /ai-tests/generate — reuse-or-generate đề cho job. */
  generate: (jobId: string, testType: AiTestType) =>
    http.post<ApiResponse<GenerateResult>>('/ai-tests/generate', { jobId, testType }),

  /** GET /ai-tests/assignment/:assignmentId — chi tiết bài làm (đề + answers). */
  getAssignmentDetail: (assignmentId: string) =>
    http.get<ApiResponse<AssignmentDetail>>(`/ai-tests/assignment/${assignmentId}`),

  /** GET /ai-tests/job/:jobId — danh sách đề của job. */
  listForJob: (jobId: string) =>
    http.get<ApiResponse<AiTestSummary[]>>(`/ai-tests/job/${jobId}`),

  /** GET /ai-tests/:testId — review đề đầy đủ (kèm đáp án). */
  getDetail: (testId: string) =>
    http.get<ApiResponse<AiTestDetail>>(`/ai-tests/${testId}`),

  /** GET /ai-tests/application/:applicationId — assignments của application. */
  listAssignments: (applicationId: string) =>
    http.get<ApiResponse<TestAssignmentRow[]>>(`/ai-tests/application/${applicationId}`),

  /** POST /ai-tests/assign — giao bài + n8n email. */
  assign: (applicationId: string, testId: string) =>
    http.post<ApiResponse<AssignResult>>('/ai-tests/assign', { applicationId, testId }),

  // ---- Public (candidate) ----

  getPublicTest: (token: string) =>
    http.get<ApiResponse<PublicTest>>(`/ai-tests/public/${token}`),

  /** POST /public/:token/answer — autosave 1 câu (fire-and-forget). */
  saveAnswer: (token: string, questionId: string, answer: string) =>
    http.post<ApiResponse<true>>(`/ai-tests/public/${token}/answer`, { questionId, answer }),

  submitTest: (token: string, answers: Record<string, string>) =>
    http.post<ApiResponse<SubmitResult>>(`/ai-tests/public/${token}/submit`, { answers }),
};
