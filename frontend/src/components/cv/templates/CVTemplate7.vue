<script setup lang="ts">
/**
 * CVTemplate7.vue — Ocean Teal Executive Resume Template
 *
 * Phong cách thiết kế:
 *   - Font Serif (Playfair Display / Georgia) cho Tên ứng viên, Tiêu đề công việc và Heading
 *   - Font Sans-serif (Inter) cho nội dung chi tiết
 *   - Tên ứng viên màu xanh ngọc biển (#3f96a0) in hoa đậm nét
 *   - Thanh banner thông tin liên hệ ngang toàn chiều rộng màu xanh mint (#a7d3d6)
 *   - Bố cục 2 cột: Cột trái (Kinh nghiệm, Dự án), Cột phải (Kỹ năng dạng pill tags #a6d1d7, Học vấn, Người tham chiếu)
 */
import { computed } from 'vue';
import { Phone, Mail, MapPin, Globe } from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';
import { CV_LABELS, type CvLanguage, type CvSectionKey } from '@/utils/cvLabels';

const props = withDefaults(
  defineProps<{
    data: CvRenderData;
    disableLinks?: boolean;
    /** Ngôn ngữ tiêu đề section ('vi' | 'en' — default 'en'). */
    language?: CvLanguage;
  }>(),
  { disableLinks: false, language: 'en' },
);

/** Tra nhãn section theo ngôn ngữ hiện tại — xem [cvLabels.ts](../../utils/cvLabels.ts). */
const t = (k: CvSectionKey): string => CV_LABELS[props.language][k];

/** Khoảng thời gian (start – end) */
const dateRange = (start: string | undefined, end: string | undefined): string => {
  const s = start ?? '';
  const e = end ?? '';
  if (!s && !e) return '';
  if (s && !e) return s;
  if (!s && e) return e;
  return `${s} – ${e}`;
};

/** Tách description thành các dòng gạch đầu dòng */
const toLines = (text: string | undefined | null): string[] =>
  (text ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);

/** Tách summary thành các đoạn văn */
const summaryParas = computed<string[]>(() =>
  (props.data.summary ?? '')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean),
);

/** Link web / portfolio / linkedin */
const webLink = computed<string>(() => {
  return (
    props.data.personalInfo.portfolio ||
    props.data.personalInfo.linkedin ||
    props.data.personalInfo.github ||
    ''
  );
});

/** Text rút gọn của website hiển thị */
const webDisplay = computed<string>(() => {
  const raw = webLink.value;
  if (!raw) return '';
  return raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');
});
</script>

<template>
  <div class="cv-t7-page">
    <!-- ==================== HEADER (FULL WIDTH) ==================== -->
    <header class="cv-t7-header">
      <h1 class="candidate-name">
        {{ data.personalInfo.fullName || 'JOHN SMITH' }}
      </h1>
      <h2 class="candidate-position">
        {{ data.personalInfo.position || 'Business Development Executive' }}
      </h2>
      <div v-if="summaryParas.length" class="summary-text">
        <p v-for="(p, i) in summaryParas" :key="i">{{ p }}</p>
      </div>
      <p v-else class="summary-text">
        Lorem ipsum is simply dummy text of the printing and typesetting industry. Lorem ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book.
      </p>
    </header>

    <!-- ==================== CONTACT BAR (FULL WIDTH) ==================== -->
    <div class="cv-t7-contact-bar">
      <!-- Phone -->
      <div v-if="data.personalInfo.phone" class="contact-col">
        <Phone class="contact-ico" :size="13" />
        <span v-if="disableLinks" class="contact-val">{{ data.personalInfo.phone }}</span>
        <a v-else :href="`tel:${data.personalInfo.phone}`" class="contact-link">{{ data.personalInfo.phone }}</a>
      </div>

      <!-- Email -->
      <div v-if="data.personalInfo.email" class="contact-col">
        <Mail class="contact-ico" :size="13" />
        <span v-if="disableLinks" class="contact-val">{{ data.personalInfo.email }}</span>
        <a v-else :href="`mailto:${data.personalInfo.email}`" class="contact-link">{{ data.personalInfo.email }}</a>
      </div>

      <!-- Address -->
      <div v-if="data.personalInfo.address" class="contact-col">
        <MapPin class="contact-ico" :size="13" />
        <span class="contact-val">{{ data.personalInfo.address }}</span>
      </div>

      <!-- Website / Portfolio -->
      <div v-if="webDisplay" class="contact-col">
        <Globe class="contact-ico" :size="13" />
        <span v-if="disableLinks" class="contact-val">{{ webDisplay }}</span>
        <a
          v-else
          :href="webLink.startsWith('http') ? webLink : `https://${webLink}`"
          target="_blank"
          rel="noopener noreferrer"
          class="contact-link"
        >{{ webDisplay }}</a>
      </div>
    </div>

    <!-- ==================== BODY (2 COLUMNS) ==================== -->
    <div class="cv-t7-body">
      <!-- ===== CỘT TRÁI: KINH NGHIỆM + DỰ ÁN ===== -->
      <main class="body-left">
        <!-- WORK EXPERIENCE -->
        <section v-if="data.experiences?.length" class="section-block">
          <h3 class="section-heading">{{ t('experience') }}</h3>
          <div class="exp-list">
            <article v-for="(exp, i) in data.experiences" :key="i" class="exp-item">
              <h4 class="exp-role">{{ exp.position }}</h4>
              <div class="exp-company">{{ exp.company }}</div>
              <div v-if="exp.startDate || exp.endDate" class="exp-date">
                {{ dateRange(exp.startDate, exp.endDate) }}
              </div>
              <ul v-if="toLines(exp.description).length" class="exp-bullets">
                <li v-for="(line, idx) in toLines(exp.description)" :key="idx" class="bullet-item">
                  <span class="bullet-dot"></span>
                  <span class="bullet-text">{{ line }}</span>
                </li>
              </ul>
            </article>
          </div>
        </section>

        <!-- PROJECTS -->
        <section v-if="data.projects?.length" class="section-block">
          <h3 class="section-heading">{{ t('projects') }}</h3>
          <div class="exp-list">
            <article v-for="(proj, i) in data.projects" :key="i" class="exp-item">
              <h4 class="exp-role">{{ proj.name }}</h4>
              <div v-if="proj.role" class="exp-company">{{ proj.role }}</div>
              <div v-if="proj.time" class="exp-date">{{ proj.time }}</div>
              <div v-if="proj.link" class="proj-link-row">
                <span v-if="disableLinks" class="proj-link-text">{{ proj.link }}</span>
                <a v-else :href="proj.link" target="_blank" rel="noopener noreferrer" class="proj-link-anchor">{{ proj.link }}</a>
              </div>
              <ul v-if="toLines(proj.description).length" class="exp-bullets">
                <li v-for="(line, idx) in toLines(proj.description)" :key="idx" class="bullet-item">
                  <span class="bullet-dot"></span>
                  <span class="bullet-text">{{ line }}</span>
                </li>
              </ul>
            </article>
          </div>
        </section>

        <!-- ACTIVITIES -->
        <section v-if="data.activities?.length" class="section-block">
          <h3 class="section-heading">{{ t('activities') }}</h3>
          <div class="exp-list">
            <article v-for="(act, i) in data.activities" :key="i" class="exp-item">
              <h4 class="exp-role">{{ act.name }}</h4>
              <div v-if="act.role" class="exp-company">{{ act.role }}</div>
              <div v-if="act.time" class="exp-date">{{ act.time }}</div>
              <p v-if="act.description" class="bullet-text mt-1">{{ act.description }}</p>
            </article>
          </div>
        </section>
      </main>

      <!-- ===== CỘT PHẢI: KỸ NĂNG + HỌC VẤN + CHỨNG CHỈ / THAM CHIẾU ===== -->
      <aside class="body-right">
        <!-- SKILLS -->
        <section v-if="data.skills?.length" class="section-block">
          <h3 class="section-heading">{{ t('skills') }}</h3>
          <div class="skills-grid">
            <span v-for="(s, i) in data.skills" :key="i" class="skill-pill">
              {{ s.name }}
            </span>
          </div>
        </section>

        <!-- EDUCATION -->
        <section v-if="data.educations?.length" class="section-block">
          <h3 class="section-heading">{{ t('education') }}</h3>
          <div class="edu-list">
            <article v-for="(edu, i) in data.educations" :key="i" class="edu-item">
              <h4 class="edu-degree">{{ edu.degree || edu.major || t('degree') }}</h4>
              <div v-if="edu.startYear || edu.endYear" class="edu-years">
                {{ edu.startYear ? `${edu.startYear}${edu.endYear ? `-${edu.endYear}` : ''}` : (edu.endYear ?? '') }}
              </div>
              <div class="edu-school">{{ edu.school }}</div>
              <p v-if="edu.description" class="edu-desc">{{ edu.description }}</p>
            </article>
          </div>
        </section>

        <!-- CERTIFICATES / REFERENCES -->
        <section v-if="data.certificates?.length" class="section-block">
          <h3 class="section-heading">{{ t('certificates') }}</h3>
          <div class="ref-grid">
            <article v-for="(cert, i) in data.certificates" :key="i" class="ref-card">
              <div class="ref-title-row">
                <span class="bullet-dot"></span>
                <h4 class="ref-name">{{ cert.name }}</h4>
              </div>
              <div v-if="cert.issuer" class="ref-role">{{ cert.issuer }}</div>
              <div v-if="cert.date" class="ref-contact">{{ cert.date }}</div>
            </article>
          </div>
        </section>
        <section v-else class="section-block">
          <h3 class="section-heading">{{ t('references') }}</h3>
          <div class="ref-grid">
            <article class="ref-card">
              <div class="ref-title-row">
                <span class="bullet-dot"></span>
                <h4 class="ref-name">Jane Doe</h4>
              </div>
              <div class="ref-role">Senior Manager</div>
              <div class="ref-contact">P: +123 456 789</div>
            </article>
            <article class="ref-card">
              <div class="ref-title-row">
                <span class="bullet-dot"></span>
                <h4 class="ref-name">Helene Doe</h4>
              </div>
              <div class="ref-role">HR Manager</div>
              <div class="ref-contact">P: +123 456 789</div>
            </article>
          </div>
        </section>

        <!-- INTERESTS -->
        <section v-if="data.interests?.length" class="section-block">
          <h3 class="section-heading">{{ t('interests') }}</h3>
          <div class="skills-grid">
            <span v-for="(it, i) in data.interests" :key="i" class="skill-pill">
              {{ it }}
            </span>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;0,900;1,400;1,600&family=Inter:wght@400;500;600;700&display=swap');

.cv-t7-page {
  --teal-accent: #3f96a0;
  --teal-banner: #a7d3d6;
  --teal-pill: #a6d1d7;
  --navy-dark: #051522;
  --text-body: #475569;
  --text-muted: #64748b;
  --line-dark: #051522;

  width: 100%;
  min-height: 1123px;
  background: #ffffff;
  padding: 40px 0;
  box-sizing: border-box;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--text-body);
  font-size: 11px;
  line-height: 1.5;
}

/* ==================== HEADER ==================== */
.cv-t7-header {
  padding: 0 44px;
}

.candidate-name {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 38px;
  font-weight: 900;
  color: var(--teal-accent);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 1.1;
  margin: 0 0 6px 0;
}

.candidate-position {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 18px;
  font-weight: 700;
  color: var(--navy-dark);
  margin: 0 0 12px 0;
  letter-spacing: 0.2px;
}

.summary-text {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-body);
  text-align: justify;
}

.summary-text p {
  margin: 0;
}

.summary-text p + p {
  margin-top: 6px;
}

/* ==================== CONTACT BAR ==================== */
.cv-t7-contact-bar {
  background: var(--teal-banner);
  margin: 20px 0 28px 0;
  padding: 9px 44px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.contact-col {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--navy-dark);
  font-size: 11px;
  font-weight: 500;
}

.contact-ico {
  flex-shrink: 0;
  color: var(--navy-dark);
}

.contact-val {
  color: var(--navy-dark);
}

.contact-link {
  color: var(--navy-dark);
  text-decoration: none;
}

.contact-link:hover {
  text-decoration: underline;
}

/* ==================== BODY ==================== */
.cv-t7-body {
  display: flex;
  gap: 36px;
  padding: 0 44px;
}

.body-left {
  flex: 58;
  min-width: 0;
}

.body-right {
  flex: 42;
  min-width: 0;
}

.section-block {
  margin-bottom: 24px;
}

.section-heading {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 17px;
  font-weight: 900;
  color: var(--navy-dark);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 2px solid var(--line-dark);
  padding-bottom: 4px;
  margin: 0 0 14px 0;
}

/* Experience */
.exp-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.exp-item {
  page-break-inside: avoid;
}

.exp-role {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--navy-dark);
  margin: 0 0 2px 0;
}

.exp-company {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--teal-accent);
  margin-bottom: 2px;
}

.exp-date {
  font-size: 10.5px;
  font-style: italic;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.exp-bullets {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bullet-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-body);
}

.bullet-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background-color: var(--teal-accent);
  flex-shrink: 0;
  margin-top: 5px;
}

.bullet-text {
  flex: 1;
}

.proj-link-row {
  font-size: 10.5px;
  margin-bottom: 6px;
}

.proj-link-anchor {
  color: var(--teal-accent);
  text-decoration: underline;
}

/* Skills */
.skills-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.skill-pill {
  background: var(--teal-pill);
  color: var(--navy-dark);
  font-size: 11px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 5px;
  white-space: nowrap;
}

/* Education */
.edu-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.edu-item {
  page-break-inside: avoid;
}

.edu-degree {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--navy-dark);
  margin: 0 0 2px 0;
}

.edu-years {
  font-size: 11px;
  color: var(--text-body);
  margin-bottom: 1px;
}

.edu-school {
  font-size: 11px;
  font-style: italic;
  color: var(--text-muted);
}

.edu-desc {
  font-size: 10.5px;
  color: var(--text-body);
  margin-top: 4px;
}

/* References / Certificates */
.ref-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.ref-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  page-break-inside: avoid;
}

.ref-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ref-name {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--navy-dark);
  margin: 0;
}

.ref-role {
  font-size: 10.5px;
  font-style: italic;
  color: var(--text-muted);
  padding-left: 11px;
}

.ref-contact {
  font-size: 10px;
  color: var(--text-body);
  padding-left: 11px;
}

@media print {
  .cv-t7-page {
    padding: 24px 0;
  }
}
</style>
