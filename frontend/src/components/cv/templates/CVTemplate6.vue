<script setup lang="ts">
import { computed } from 'vue';
import { Phone, Mail, Globe, MapPin, Linkedin, Github } from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';
import { CV_LABELS, type CvLanguage, type CvSectionKey } from '@/utils/cvLabels';

const props = withDefaults(
  defineProps<{
    data: CvRenderData;
    disableLinks?: boolean;
    /** Ngôn ngữ tiêu đề section ('vi' | 'en'). Default 'en'. */
    language?: CvLanguage;
  }>(),
  { disableLinks: false, language: 'en' },
);

/** Tra nhãn section theo ngôn ngữ hiện tại — xem [cvLabels.ts](../../utils/cvLabels.ts). */
const t = (k: CvSectionKey): string => CV_LABELS[props.language][k];

/** Lấy chữ cái đầu làm avatar fallback */
const initial = (name: string | undefined | null): string => {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};

/** Hiển thị khoảng thời gian linh hoạt */
const dateRange = (start: string | undefined, end: string | undefined): string => {
  const s = start ?? '';
  const e = end ?? '';
  if (!s && !e) return '';
  if (s && !e) return s;
  if (!s && e) return e;
  return `${s} — ${e}`;
};

/** Tách description thành các dòng không chứa ký tự bullet */
const toLines = (text: string | undefined | null): string[] =>
  (text ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);

/** Tách description thành đoạn intro (dòng đầu) và danh sách bullets (các dòng sau) */
const splitDesc = (text: string | undefined | null): { intro: string; bullets: string[] } => {
  const lines = toLines(text);
  if (lines.length <= 1) return { intro: lines[0] ?? '', bullets: [] };
  return { intro: lines[0], bullets: lines.slice(1) };
};

/** Tách summary thành các đoạn văn */
const profileParas = computed<string[]>(() =>
  (props.data.summary ?? '')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean),
);

/** Chia skills thành 2 nhóm Personal và Technical bám theo thiết kế.
 *  Label lấy từ CV_LABELS theo language — computed re-run khi language đổi. */
const skillGroups = computed<{ label: string; items: string[] }[]>(() => {
  const all = props.data.skills ?? [];
  if (!all.length) return [];
  const half = Math.ceil(all.length / 2);
  return [
    { label: CV_LABELS[props.language].personal, items: all.slice(0, half).map((s) => s.name) },
    { label: CV_LABELS[props.language].technical, items: all.slice(half).map((s) => s.name) },
  ].filter((g) => g.items.length);
});

/** Danh sách liên hệ cho khối trên cùng bên phải */
const contacts = computed(() => {
  const p = props.data.personalInfo;
  return [
    { icon: Phone, text: p.phone, isLink: false },
    { icon: Mail, text: p.email, isLink: false },
    { icon: Globe, text: p.portfolio, isLink: true, url: p.portfolio },
    { icon: Linkedin, text: p.linkedin, isLink: true, url: p.linkedin },
    { icon: Github, text: p.github, isLink: true, url: p.github },
  ].filter((c) => Boolean(c.text));
});

/** Xử lý địa chỉ thành tiêu đề và chi tiết */
const addressParts = computed(() => {
  const addr = props.data.personalInfo.address?.trim() ?? '';
  if (!addr) return null;
  const parts = addr.split('\n');
  if (parts.length > 1) {
    return { title: parts[0], detail: parts.slice(1).join(', ') };
  }
  return { title: CV_LABELS[props.language].addressLocation, detail: addr };
});
</script>

<template>
  <div class="cv-t6-page">
    <!-- ==================== HEADER ==================== -->
    <header class="cv-t6-header">
      <!-- Cột tên và chức danh dọc bên trái -->
      <div class="name-box">
        <div class="yellow-top-shape" />
        <div class="name-col">
          <div class="name-text">
            {{ data.personalInfo.fullName || t('fullName') }}
          </div>
          <div v-if="data.personalInfo.position" class="role-text">
            {{ data.personalInfo.position }}
          </div>
        </div>
      </div>

      <!-- Ảnh chân dung và tab vàng trang trí -->
      <div class="photo-wrap">
        <div class="photo">
          <img
            v-if="data.personalInfo.avatarUrl"
            :src="data.personalInfo.avatarUrl"
            :alt="data.personalInfo.fullName"
          />
          <div v-else class="photo-placeholder">
            <span class="photo-initial">{{ initial(data.personalInfo.fullName) }}</span>
          </div>
        </div>
        <div class="photo-yellow-tab" />
      </div>

      <!-- Khối bên phải của Header: Địa chỉ, Liên hệ, Profile -->
      <div class="head-right">
        <div class="top-info">
          <!-- Thông tin công ty / địa chỉ -->
          <div v-if="addressParts" class="company-block">
            <b>{{ addressParts.title }}</b>
            <span>{{ addressParts.detail }}</span>
          </div>
          <div v-else class="company-block">
            <b>{{ data.title || t('curriculumVitae') }}</b>
          </div>

          <!-- Các mục liên hệ kèm icon hộp vàng -->
          <div v-if="contacts.length" class="contacts-block">
            <div v-for="(c, i) in contacts" :key="i" class="contact-item">
              <span class="contact-icon">
                <component :is="c.icon" :size="12" />
              </span>
              <template v-if="c.isLink && c.url && !disableLinks">
                <a
                  :href="c.url.startsWith('http') ? c.url : `https://${c.url}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="contact-text contact-link"
                >
                  {{ c.text }}
                </a>
              </template>
              <span v-else class="contact-text">{{ c.text }}</span>
            </div>
          </div>
        </div>

        <!-- Khối Profile tóm tắt -->
        <div v-if="profileParas.length" class="profile-section">
          <h2 class="profile-heading">{{ t('profile') }}</h2>
          <div class="profile-content">
            <p v-for="(p, i) in profileParas" :key="i">
              {{ p }}
            </p>
          </div>
        </div>
      </div>
    </header>

    <!-- ==================== BODY 2 CỘT ==================== -->
    <main class="cv-t6-body">
      <!-- Cột trái: WORK EXPERIENCE + PROJECTS -->
      <div class="body-left">
        <!-- Work Experience -->
        <section v-if="data.experiences.length" class="section-exp">
          <h2 class="section-title">{{ t('experience') }}</h2>

          <article
            v-for="(x, i) in data.experiences"
            :key="i"
            class="job-item"
          >
            <div class="job-head">
              <span class="job-title">{{ x.position }}</span>
              <span v-if="x.startDate || x.endDate" class="job-date">
                {{ dateRange(x.startDate, x.endDate) }}
              </span>
            </div>
            <div v-if="x.company" class="job-sub">{{ x.company }}</div>

            <p v-if="splitDesc(x.description).intro" class="job-intro">
              {{ splitDesc(x.description).intro }}
            </p>
            <ul v-if="splitDesc(x.description).bullets.length" class="job-bullets">
              <li v-for="(bullet, j) in splitDesc(x.description).bullets" :key="j">
                {{ bullet }}
              </li>
            </ul>
          </article>
        </section>

        <!-- Projects -->
        <section v-if="data.projects.length" class="section-projects">
          <h2 class="section-title">{{ t('projects') }}</h2>

          <article
            v-for="(p, i) in data.projects"
            :key="i"
            class="job-item"
          >
            <div class="job-head">
              <span class="job-title">{{ p.name }}</span>
              <span v-if="p.time" class="job-date">{{ p.time }}</span>
            </div>
            <div v-if="p.role" class="job-sub">{{ p.role }}</div>

            <p v-if="p.description" class="job-intro">{{ p.description }}</p>

            <div v-if="p.link" class="project-link-row">
              <template v-if="!disableLinks">
                <a
                  :href="p.link.startsWith('http') ? p.link : `https://${p.link}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="project-link"
                >
                  {{ p.link }}
                </a>
              </template>
              <span v-else class="project-link text-only">{{ p.link }}</span>
            </div>
          </article>
        </section>
      </div>

      <!-- Cột phải: EDUCATION + SKILLS + REFERENCES / CERTIFICATES -->
      <aside class="body-right">
        <!-- Education -->
        <section v-if="data.educations.length" class="section-edu">
          <h2 class="section-title">{{ t('education') }}</h2>
          <div
            v-for="(e, i) in data.educations"
            :key="i"
            class="edu-item"
          >
            <span class="edu-title">{{ e.degree || e.major || e.school }}</span>
            <div class="edu-school">{{ e.school }}</div>
            <div v-if="e.startYear || e.endYear" class="edu-date">
              {{ dateRange(e.startYear, e.endYear) }}
            </div>
            <p v-if="e.description" class="edu-desc">{{ e.description }}</p>
          </div>
        </section>

        <!-- Skills -->
        <section v-if="skillGroups.length" class="section-skills">
          <h2 class="section-title">{{ t('skills') }}</h2>
          <div
            v-for="(group, gi) in skillGroups"
            :key="gi"
            class="skill-group"
          >
            <div class="skill-subtitle">{{ group.label }}</div>
            <ul class="skill-list">
              <li v-for="(s, si) in group.items" :key="si">{{ s }}</li>
            </ul>
          </div>
        </section>

        <!-- References / Certificates -->
        <section v-if="data.certificates.length" class="section-ref">
          <h2 class="section-title">{{ t('references') }}</h2>
          <div
            v-for="(c, i) in data.certificates"
            :key="i"
            class="ref-item"
          >
            <span class="ref-name">{{ c.name }}</span>
            <div v-if="c.issuer" class="ref-role">{{ c.issuer }}</div>
            <div v-if="c.date" class="ref-row">
              <span class="ref-label">{{ t('dateLabel') }}:</span>
              <span class="ref-val">{{ c.date }}</span>
            </div>
          </div>
        </section>

        <!-- Activities (nếu có) -->
        <section v-if="data.activities.length" class="section-act">
          <h2 class="section-title">{{ t('activities') }}</h2>
          <div
            v-for="(a, i) in data.activities"
            :key="i"
            class="edu-item"
          >
            <span class="edu-title">{{ a.name }}</span>
            <div v-if="a.role" class="edu-school">{{ a.role }}</div>
            <div v-if="a.time" class="edu-date">{{ a.time }}</div>
            <p v-if="a.description" class="edu-desc">{{ a.description }}</p>
          </div>
        </section>

        <!-- Interests (nếu có) -->
        <section v-if="data.interests?.length" class="section-interests">
          <h2 class="section-title">{{ t('interests') }}</h2>
          <ul class="skill-list">
            <li v-for="(it, i) in data.interests" :key="i">{{ it }}</li>
          </ul>
        </section>
      </aside>
    </main>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');

/* ==================== DESIGN TOKENS ==================== */
.cv-t6-page {
  --yellow: #fec901;
  --navy: #141b3a;
  --text: #5a6072;
  --line: #c9ceda;
  --divider: #7b8192;

  width: 100%;
  min-height: 1123px;
  background: #ffffff;
  padding: 30px 34px 34px;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;

  font-family: 'Poppins', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
  color: var(--text);
  font-size: 11px;
  line-height: 1.6;
}

/* ==================== HEADER ==================== */
.cv-t6-header {
  display: flex;
  gap: 18px;
  min-height: 290px;
  position: relative;
  margin-bottom: 24px;
}

/* Cột tên bên trái */
.name-box {
  width: 86px;
  flex-shrink: 0;
  position: relative;
  margin: -30px 0 0 -34px;
  padding: 30px 0 0 34px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

/* Khối vàng góc trên trái cắt chéo 45 độ */
.yellow-top-shape {
  position: absolute;
  left: 0;
  top: 0;
  width: 92px;
  height: 140px;
  background: var(--yellow);
  clip-path: polygon(0 0, 46px 0, 92px 46px, 92px 140px, 0 48px);
  z-index: 1;
}

/* Text viết dọc (writing-mode: vertical-lr) */
.name-col {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  height: 280px;
  gap: 6px;
  padding-left: 12px;
}

.name-text {
  writing-mode: vertical-lr;
  text-orientation: mixed;
  font-size: 25px;
  font-weight: 800;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: var(--navy);
  white-space: nowrap;
  line-height: 1;
}

.role-text {
  writing-mode: vertical-lr;
  text-orientation: mixed;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--navy);
  white-space: nowrap;
  line-height: 1;
  margin-bottom: 2px;
}

/* Khung ảnh chân dung */
.photo-wrap {
  position: relative;
  width: 195px;
  height: 270px;
  flex-shrink: 0;
  margin-top: 2px;
}

.photo {
  width: 100%;
  height: 100%;
  border-radius: 14px;
  overflow: hidden;
  background: #2a2d34;
  display: flex;
  align-items: center;
  justify-content: center;
}

.photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: grayscale(1);
}

.photo-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(145deg, #475569, #1e293b);
  display: flex;
  align-items: center;
  justify-content: center;
}

.photo-initial {
  font-size: 72px;
  font-weight: 800;
  color: #f1f5f9;
}

.photo-yellow-tab {
  position: absolute;
  right: -16px;
  bottom: 0;
  width: 16px;
  height: 76px;
  background: var(--yellow);
  clip-path: polygon(0 0, 100% 16px, 100% 100%, 0 100%);
}

/* Khối bên phải Header */
.head-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.top-info {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.company-block {
  max-width: 215px;
  font-size: 10.5px;
  line-height: 1.5;
}

.company-block b {
  display: block;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 2px;
}

.company-block span {
  color: var(--text);
}

.contacts-block {
  width: 205px;
  flex-shrink: 0;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px solid var(--line);
  font-size: 10.5px;
  color: var(--navy);
  font-weight: 500;
}

.contact-item:last-child {
  border-bottom: none;
}

.contact-icon {
  width: 21px;
  height: 21px;
  background: var(--yellow);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--navy);
}

.contact-text {
  overflow-wrap: anywhere;
}

.contact-link {
  color: var(--navy);
  text-decoration: none;
  transition: opacity 0.2s;
}

.contact-link:hover {
  text-decoration: underline;
}

.profile-section {
  margin-top: 10px;
}

.profile-heading {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: var(--navy);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 8px;
}

.profile-content p {
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--text);
  margin: 0;
}

.profile-content p + p {
  margin-top: 6px;
}

/* ==================== BODY ==================== */
.cv-t6-body {
  display: flex;
  gap: 26px;
}

.body-left {
  flex: 1;
  min-width: 0;
}

.body-right {
  width: 265px;
  flex-shrink: 0;
  border-left: 1px solid var(--divider);
  padding-left: 26px;
}

/* Tiêu đề chung của các section */
.section-title {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: var(--navy);
  padding-bottom: 5px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 16px;
}

/* Item công việc & dự án */
.job-item {
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

.job-item:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.section-projects {
  margin-top: 22px;
}

.job-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.job-title {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--navy);
}

.job-date {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--navy);
  white-space: nowrap;
}

.job-sub {
  font-size: 12px;
  color: var(--navy);
  margin: 2px 0 6px;
}

.job-intro {
  font-size: 10px;
  line-height: 1.55;
  color: var(--text);
  margin-bottom: 6px;
}

.job-bullets {
  list-style: none;
  padding: 0;
  margin: 0;
}

.job-bullets li {
  position: relative;
  padding-left: 18px;
  font-size: 10px;
  line-height: 1.6;
  color: var(--text);
}

.job-bullets li::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--navy);
}

.project-link-row {
  margin-top: 4px;
}

.project-link {
  font-size: 10px;
  color: #2563eb;
  text-decoration: underline;
  word-break: break-all;
}

.project-link.text-only {
  text-decoration: none;
  color: var(--text);
}

/* Right column sections */
.body-right section {
  margin-bottom: 20px;
}

.body-right section:last-child {
  margin-bottom: 0;
}

.edu-item {
  margin-bottom: 14px;
}

.edu-item:last-child {
  margin-bottom: 0;
}

.edu-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--navy);
  display: block;
}

.edu-school {
  font-size: 10.5px;
  color: var(--navy);
  margin-top: 1px;
}

.edu-date {
  font-size: 10px;
  color: var(--text);
  margin-top: 1px;
}

.edu-desc {
  font-size: 10px;
  color: var(--text);
  margin-top: 3px;
  line-height: 1.5;
}

/* Skills */
.skill-group + .skill-group {
  margin-top: 12px;
}

.skill-subtitle {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--navy);
  margin: 0 0 4px;
}

.skill-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.skill-list li {
  position: relative;
  padding-left: 18px;
  font-size: 10px;
  line-height: 1.7;
  color: var(--text);
}

.skill-list li::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--navy);
}

/* References */
.ref-item {
  margin-bottom: 14px;
  font-size: 10px;
  line-height: 1.6;
}

.ref-item:last-child {
  margin-bottom: 0;
}

.ref-name {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--navy);
  display: block;
  margin-bottom: 1px;
}

.ref-role {
  font-size: 10px;
  color: var(--navy);
  margin-bottom: 2px;
}

.ref-row {
  display: flex;
  gap: 4px;
}

.ref-label {
  font-weight: 600;
  color: var(--navy);
  width: 46px;
  flex-shrink: 0;
}

.ref-val {
  color: var(--text);
}

/* Print Styles */
@media print {
  .cv-t6-page {
    padding: 24px 28px;
  }
}
</style>
