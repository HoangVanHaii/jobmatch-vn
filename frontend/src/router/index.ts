/**
 * Vue Router — route guards (auth, role, plan)
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@stores/auth';

const routes: RouteRecordRaw[] = [
  // Public
  // { path: '/', name: 'home', component: () => import('@views/HomeView.vue') },
  { path: '/login', name: 'login', component: () => import('@views/auth/LoginView.vue'), meta: { guest: true } },
  { path: '/register', name: 'register', component: () => import('@views/auth/RegisterView.vue'), meta: { guest: true } },
  { path: '/verify-otp', name: 'verify-otp', component: () => import('@views/auth/VerifyOtpView.vue'), meta: { guest: true } },
  { path: '/forgot-password', name: 'forgot-password', component: () => import('@views/auth/ForgotPasswordView.vue') },
  { path: '/auth/callback/:provider', name: 'oauth-callback', component: () => import('@views/auth/OAuthCallbackView.vue') },
  { path: '/onboarding', name: 'onboarding', component: () => import('@views/auth/OnboardingView.vue'), meta: { auth: true } },
  { path: '/pricing', name: 'pricing', component: () => import('@views/PricingView.vue') },
  { path: '/jobs', name: 'jobs', component: () => import('@views/JobListView.vue') },
  { path: '/jobs/:id', name: 'job-detail', component: () => import('@views/JobDetailView.vue') },
  { path: '/search', name: 'search', component: () => import('@views/SearchView.vue') },

  // Candidate
  {
    path: '/candidate',
    component: () => import('@views/candidate/CandidateLayout.vue'),
    meta: { auth: true, role: 'candidate' },
    children: [
    //   { path: '', name: 'candidate-dashboard', component: () => import('@views/candidate/CandidateDashboard.vue') },
      { path: '', redirect: 'resumes' },
      { path: 'resumes', name: 'my-resumes', component: () => import('@views/candidate/MyResumesView.vue') },
      { path: 'resumes/new', name: 'create-resume', component: () => import('@views/candidate/CreateResumeView.vue') },
      { path: 'chatbot', name: 'chatbot', component: () => import('@views/chat/ChatbotView.vue'), meta: { auth: true }}, 
      // resume-detail (placeholder) đã gỡ — preview CV xem qua modal
      // trong MyResumesView thay vì riêng 1 trang.
    //   { path: 'resumes/:id', name: 'resume-detail', component: () => import('@views/candidate/ResumeDetailView.vue') },
    //   { path: 'applications', name: 'my-applications', component: () => import('@views/candidate/AppliedJobsView.vue') },
    //   { path: 'saved', name: 'saved-jobs', component: () => import('@views/candidate/SavedJobsView.vue') },
    //   { path: 'cv-score', name: 'cv-score', component: () => import('@views/candidate/CVScoringView.vue') },
    //   { path: 'settings', name: 'candidate-settings', component: () => import('@views/candidate/SettingsView.vue') },
    ],
  },

  // Employer
  // {
  //   path: '/employer',
  //   meta: { auth: true, role: 'employer' },
  //   children: [
  //     { path: '', name: 'employer-dashboard', component: () => import('@views/employer/EmployerDashboard.vue') },
  //     { path: 'jobs/new', name: 'create-job', component: () => import('@views/employer/CreateJobView.vue') },
  //     { path: 'jobs', name: 'posted-jobs', component: () => import('@views/employer/PostedJobsView.vue') },
  //     { path: 'applications', name: 'employer-applications', component: () => import('@views/employer/ApplicationsView.vue') },
  //     { path: 'chat', name: 'employer-chat', component: () => import('@views/employer/EmployerChatView.vue') },
  //     { path: 'analytics', name: 'employer-analytics', component: () => import('@views/employer/AnalyticsView.vue') },
  //     { path: 'settings', name: 'employer-settings', component: () => import('@views/employer/CompanyVerificationView.vue') },
  //   ],
  // },

  // Chat — `/chat` empty, `/chat/:id` mở 1 conversation, `/chat?peer=<userId>` deep-link
  {
    path: '/chat/:id?',
    name: 'chat',
    component: () => import('@views/chat/ChatView.vue'),
    meta: { auth: true },
  },

  // Chatbot AI JobMatch — trang full-page, candidate + employer đều dùng
  

  // Admin
  // {
  //   path: '/admin',
  //   meta: { auth: true, role: 'admin' },
  //   children: [
  //     { path: '', name: 'admin-dashboard', component: () => import('@views/admin/DashBoardAdmin.vue') },
  //     { path: 'users', name: 'admin-users', component: () => import('@views/admin/CandidateManagement.vue') },
  //     { path: 'jobs', name: 'admin-jobs', component: () => import('@views/admin/AllJobManagement.vue') },
  //     { path: 'companies', name: 'admin-companies', component: () => import('@views/admin/CompanyManagement.vue') },
  //   ],
  // },

  // Errors
  { path: '/403', name: 'forbidden', component: () => import('@views/errors/Forbidden.vue') },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@views/errors/PageNotFound.vue') },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Guards
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.ensureInit(); // đợi auth được khôi phục trước khi guard đánh giá
  if (to.meta.auth && !auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
  // Lưu ý: route 'home' đang bị comment out → phải redirect về route có thật
  if (to.meta.guest && auth.isAuthenticated) return { name: 'jobs' };
  if (to.meta.role && auth.user?.role !== to.meta.role) return { name: 'forbidden' };
  return true;
});