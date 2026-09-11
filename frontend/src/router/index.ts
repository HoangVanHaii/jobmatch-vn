/**
 * Vue Router — route guards (auth, role, plan)
 */
import ChatView from '@views/chat/ChatView.vue';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@stores/auth';

const routes: RouteRecordRaw[] = [
  // Public
  // { path: '/', name: 'home', component: () => import('@views/HomeView.vue') },
  { path: '/login', name: 'login', component: () => import('@views/auth/LoginView.vue'), meta: { guest: true } },
  { path: '/register', name: 'register', component: () => import('@views/auth/RegisterView.vue'), meta: { guest: true } },
  { path: '/verify-otp', name: 'verify-otp', component: () => import('@views/auth/VerifyOtpView.vue'), meta: { guest: true } },
  { path: '/forgot-password', name: 'forgot-password', component: () => import('@views/auth/ForgotPasswordView.vue') },

  // F3 FIX: /terms và /privacy — public legal pages.
  // Trước đây RegisterView có link /terms và /privacy trong consent checkbox
  // nhưng không có route → user click → 404 → vi phạm legal compliance.
  { path: '/terms', name: 'terms', component: () => import('@views/pages/TermsView.vue') },
  { path: '/privacy', name: 'privacy', component: () => import('@views/pages/PrivacyView.vue') },
  { path: '/auth/callback/:provider', name: 'oauth-callback', component: () => import('@views/auth/OAuthCallbackView.vue'),
    // Validate ngay tại route guard — invalid provider (vd user gõ /auth/callback/resumes
    // do typo hay stale tab) → redirect thẳng về /login TRƯỚC khi component mount.
    // Tránh page bị treo vô thời hạn nếu OAuthCallbackView bị stale cache hoặc HMR miss.
    beforeEnter: (to) => {
      const provider = String(to.params.provider ?? '');
      const VALID = ['google', 'facebook', 'github'];
      if (!VALID.includes(provider)) {
        return { name: 'login' };
      }
      // Thiếu `code` query param → không thể verify OAuth → redirect luôn.
      if (!to.query.code) {
        return { name: 'login' };
      }
      return true;
    },
  },
  // Select Role chỉ accessible khi có pending OAuth state (xem SelectRoleView.vue guard nội bộ).
  // Không có meta.auth vì OAuth user mới CHƯA có session — pendingToken là proof-of-intent.
  { path: '/select-role', name: 'select-role', component: () => import('@views/auth/OnboardingView.vue') },
//   { path: '/jobs', name: 'jobs', component: () => import('@views/JobListView.vue') },
//   { path: '/jobs/:id', name: 'job-detail', component: () => import('@views/JobDetailView.vue') },
//   { path: '/search', name: 'search', component: () => import('@views/SearchView.vue') },

  // Print page — render-only view cho Playwright capture PDF.
  // KHÔNG có `meta.auth` (intentionally public) vì authorize qua HMAC signed
  // token trong query string (BE cấp, TTL 120s, scope 1 cvId).
  // KHÔNG có parent layout → page trống, chỉ render CV content, không header/nav.
  { path: '/print/cv/:cvId', name: 'cv-print', component: () => import('@views/print/CvPrintView.vue') },

  // Candidate — bao gồm cả /pricing để có sidebar
  {
    path: '/candidate',
    component: () => import('@views/candidate/CandidateLayout.vue'),
    meta: { auth: true, role: 'candidate' },
    children: [
    //   { path: '', name: 'candidate-dashboard', component: () => import('@views/candidate/CandidateDashboard.vue') },
    //   { path: '', redirect: 'resumes' },
      // Default child cho /candidate — KHÔNG dùng string redirect (sẽ bị resolve
      // relative so với URL hiện tại, vd OAuthCallback gọi /candidate từ
      // /auth/callback/google → '/auth/callback/candidate' → 404 hoặc loop).
      { path: '', redirect: { name: 'candidate-jobs' } },
      { path: 'profile', name: 'candidate-profile', component: () => import('@views/candidate/ProfileView.vue') },
      { path: 'resumes', name: 'my-resumes', component: () => import('@views/candidate/MyResumesView.vue') },
      { path: 'resumes/new', name: 'create-resume', component: () => import('@views/candidate/CreateResumeView.vue') },
      // Edit CV direct — dùng CÙNG component CreateResumeView (dual-mode:
      // detect cvId từ route param → prefill form → submit PATCH thay vì POST).
      // Nav từ MyResumesView (menu "Sửa") → /resumes/:cvId/edit.
      { path: 'resumes/:cvId/edit', name: 'edit-resume', component: () => import('@views/candidate/CreateResumeView.vue'), props: true },
      { path: 'viec-lam', name: 'candidate-jobs', component: () => import('@views/candidate/JobsView.vue') },
      { path: 'viec-lam/:slug', name: 'candidate-job-detail', component: () => import('@views/candidate/JobDetailView.vue') },
      { path: 'saved-jobs', name: 'candidate-saved-jobs', component: () => import('@views/candidate/SavedJobsView.vue') },
      { path: 'applications', name: 'candidate-applications', component: () => import('@views/candidate/AppliedJobsView.vue') },
   // { path: 'chatbot', name: 'chatbot', component: () => import('@views/chat/ChatbotView.vue'), meta: { auth: true } }, 

      { path: 'chat/:id?', name: 'chat', component: ChatView, meta: { auth: true },},
      // Pricing & billing (có sidebar qua layout)
      { path: 'pricing', name: 'pricing', component: () => import('@views/PricingView.vue') },
      { path: 'billing/history', name: 'billing-history', component: () => import('@views/candidate/BillingHistoryView.vue') },
      { path: 'billing/success', name: 'billing-success', component: () => import('@views/BillingSuccessView.vue') },
      { path: 'billing/cancel', name: 'billing-cancel', component: () => import('@views/BillingCancelView.vue') },
      { path: 'chatbot', name: 'chatbot', component: () => import('@views/chat/ChatbotView.vue'), meta: { auth: true }}, 
      // resume-detail (placeholder) đã gỡ — preview CV xem qua modal
      // trong MyResumesView thay vì riêng 1 trang.
    //   { path: 'resumes/:id', name: 'resume-detail', component: () => import('@views/candidate/ResumeDetailView.vue') },
    //   { path: 'applications', name: 'my-applications', component: () => import('@views/candidate/AppliedJobsView.vue') },
    //   { path: 'saved', name: 'saved-jobs', component: () => import('@views/candidate/SavedJobsView.vue') },
    //   { path: 'cv-score', name: 'cv-score', component: () => import('@views/candidate/CVScoringView.vue') },
      { path: 'settings', name: 'candidate-settings', component: () => import('@views/candidate/SettingsView.vue') },
    ],
  },
  

  // Employer
  {
    path: '/employer',
    component: () => import('@views/employer/EmployerLayout.vue'),
    meta: { auth: true, role: 'employer' },
    children: [
      // Default → Job đã đăng (entry point quan trọng nhất của employer).
      // BẮT BUỘC dùng named route (hoặc absolute path). Relative string
      // 'jobs' sẽ được vue-router resolve dựa trên URL hiện tại — nếu user
      // vừa đăng nhập OAuth xong (URL = /auth/callback/google), relative
      // 'jobs' thành /auth/callback/jobs → match lại route oauth-callback →
      // beforeEnter invalid → loop về /login → guard guest → /jobs. User
      // thấy URL "treo" ở /auth/callback/jobs thay vì vào thẳng dashboard.
      { path: '', redirect: { name: 'employer-jobs' } },

      // Tuyển dụng
      { path: 'jobs', name: 'employer-jobs', component: () => import('@views/employer/PostedJobsView.vue') },
      { path: 'jobs/:id', name: 'employer-job-detail', component: () => import('@views/employer/JobDetailView.vue') },
      { path: 'applications', name: 'employer-applications', component: () => import('@views/employer/ApplicationsView.vue') },
      { path: 'interviews', name: 'employer-interviews', component: () => import('@views/employer/InterviewsView.vue') },

      // Công ty
      { path: 'company', name: 'employer-company', component: () => import('@views/employer/CompanyView.vue') },
      { path: 'company/members', name: 'employer-company-members', component: () => import('@views/employer/CompanyMembersView.vue') },

      // Hỗ trợ
      { path: 'chat/:id?', name: 'e-chat', component: ChatView },
      { path: 'settings', name: 'employer-settings', component: () => import('@views/employer/SettingsView.vue') },

      // Gói dịch vụ / billing
      // Pricing dùng chung view với candidate (@views/PricingView.vue) — file
      // detect role qua authStore và đổi theme/feature/redirect tương ứng.
      { path: 'pricing', name: 'employer-pricing', component: () => import('@views/PricingView.vue') },
      { path: 'billing/history', name: 'employer-billing-history', component: () => import('@views/employer/BillingHistoryView.vue') },
      { path: 'billing/success', name: 'employer-billing-success', component: () => import('@views/BillingSuccessView.vue') },
      { path: 'billing/cancel', name: 'employer-billing-cancel', component: () => import('@views/BillingCancelView.vue') },
    ],
  },

  // Chat — `/chat` empty, `/chat/:id` mở 1 conversation, `/chat?peer=<userId>` deep-link
  

  // Chatbot AI JobMatch — trang full-page, candidate + employer đều dùng
  

  // Admin
  // Layout chung + 8 children routes tương ứng 8 mục trong AdminSidebar.
  // meta.role = 'admin' + guard ở dưới đảm bảo chỉ role admin mới vào được.
  {
    path: '/admin',
    component: () => import('@views/admin/AdminLayout.vue'),
    meta: { auth: true, role: 'admin' },
    children: [
      // Default → Dashboard (entry point của admin)
      { path: '', redirect: { name: 'admin-dashboard' } },
      { path: 'dashboard', name: 'admin-dashboard', component: () => import('@views/admin/DashboardView.vue') },

      // Người dùng — 1 route duy nhất sau khi merge CandidatesView/EmployersView
      // vào UsersListView. Trang này list mọi role, có filter bên trong.
      { path: 'users', name: 'admin-users', component: () => import('@views/admin/UsersListView.vue') },

      // Nội dung
      { path: 'jobs', name: 'admin-jobs', component: () => import('@views/admin/AllJobsView.vue') },
      { path: 'companies', name: 'admin-companies', component: () => import('@views/admin/CompaniesView.vue') },
      { path: 'reports', name: 'admin-reports', component: () => import('@views/admin/ReportsView.vue') },

      // Kinh doanh — tách thành 3 mục riêng (plans CRUD / subscriptions / payments)
      // thay vì gộp "billing" chung. Mỗi workflow có use-case riêng.
      { path: 'plans', name: 'admin-plans', component: () => import('@views/admin/PlansView.vue') },
      { path: 'subscriptions', name: 'admin-subscriptions', component: () => import('@views/admin/SubscriptionsView.vue') },
      { path: 'payments', name: 'admin-payments', component: () => import('@views/admin/PaymentsView.vue') },

      // Hệ thống
      { path: 'skills', name: 'admin-skills', component: () => import('@views/admin/SkillsView.vue') },
      { path: 'notifications', name: 'admin-notifications', component: () => import('@views/admin/NotificationsView.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('@views/admin/SettingsView.vue') },
      { path: 'logs', name: 'admin-logs', component: () => import('@views/admin/LogsView.vue') },
    ],
  },

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
  // Authenticated user truy cập guest route (vd /login, /register, /verify-otp)
  // → redirect theo role, không phải về /jobs (trang public). Trước đây đẩy
  // về { name: 'jobs' } khiến candidate/employer đã login bị "rớt" ra trang
  // job list thay vì dashboard của họ.
  if (to.meta.guest && auth.isAuthenticated) {
    if (auth.user?.role === 'admin') return { name: 'admin-dashboard' };
    if (auth.user?.role === 'employer') return { name: 'employer-jobs' };
    if (auth.user?.role === 'candidate') return { name: 'candidate-jobs' };
    // Role lạ / chưa gán → fallback an toàn về /login.
    return { name: 'login' };
  }
  if (to.meta.role && auth.user?.role !== to.meta.role) return { name: 'forbidden' };
  return true;
});