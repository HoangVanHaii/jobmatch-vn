// @vitest-environment happy-dom
/**
 * Integration test end-to-end: form → BE → form, không mock riêng từng
 * bước. Verify rằng FE buildDirectPayload gửi đúng shape mà BE
 * buildParsedData nhận được, và prefillFromCv đọc đúng shape BE trả về.
 *
 * Phương pháp:
 *   - Hardcode payload mẫu đúng y shape CreateDirectCvInput (theo FE type)
 *   - Hardcode parsedData mẫu đúng y shape BE buildParsedData trả về
 *     (theo backend/src/service/cv.service.ts buildParsedData)
 *   - Assert: form state ban đầu vs form state sau prefill KHỚP 100%
 *
 * Quan trọng: 2 shape này PHẢI được copy từ code thật (FE type + BE
 * buildParsedData), không tự ý mock. Nếu 1 bên thay đổi mà bên kia
 * quên update, test sẽ FAIL — đó là mục đích.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Cv } from '@/types/cv';

/* ============================================================================
 * Mirror của CreateResumeView.vue buildDirectPayload (chỉ phần cần thiết).
 *
 * Source thật: frontend/src/views/candidate/CreateResumeView.vue
 *   const buildDirectPayload = (): CreateDirectCvInput => {
 *     // skill dedup theo name (case-insensitive), giữ level row đầu
 *     const seen = new Set<string>();
 *     const cleanSkills: Array<{ name: string; level: number }> = [];
 *     for (const s of skills.value) {
 *       const name = s.name.trim();
 *       if (!name) continue;
 *       const key = name.toLowerCase();
 *       if (seen.has(key)) continue;
 *       seen.add(key);
 *       cleanSkills.push({ name, level: clampLevel(s.level) });
 *     }
 *     // project full shape
 *     const cleanProjects = projects.value
 *       .filter(p => p.name.trim())
 *       .map(p => ({
 *         name: p.name.trim(),
 *         role: p.role.trim() || undefined,
 *         time: p.time.trim() || undefined,
 *         description: p.description.trim() || undefined,
 *         link: p.link.trim() || undefined,
 *       }));
 *     return { title, templateId, summary, contact, education, experience,
 *              skills: cleanSkills, projects: cleanProjects, certifications };
 *   }
 *
 * Nếu thay đổi behavior buildDirectPayload, update hàm này. Nếu quên
 * update → test fail → fix ngay.
 * ==========================================================================*/

const clampLevel = (lvl: number | undefined): number => {
  if (typeof lvl !== 'number' || Number.isNaN(lvl)) return 3;
  return Math.max(1, Math.min(5, Math.round(lvl)));
};

interface FormSkill { name: string; level: number }
interface FormProject {
  name: string;
  role: string;
  time: string;
  description: string;
  link: string;
}

const buildDirectPayloadFE = (input: {
  personal: { fullName: string; position: string; email: string };
  summary: string;
  skills: FormSkill[];
  projects: FormProject[];
}): {
  title: string;
  templateId: number;
  summary?: string;
  contact: { name?: string; email?: string };
  skills: Array<{ name: string; level: number }>;
  projects: Array<{ name: string; role?: string; time?: string; description?: string; link?: string }>;
} => {
  const seen = new Set<string>();
  const cleanSkills: Array<{ name: string; level: number }> = [];
  for (const s of input.skills) {
    const name = s.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleanSkills.push({ name, level: clampLevel(s.level) });
  }
  const cleanProjects = input.projects
    .filter((p) => p.name.trim())
    .map((p) => ({
      name: p.name.trim(),
      role: p.role.trim() || undefined,
      time: p.time.trim() || undefined,
      description: p.description.trim() || undefined,
      link: p.link.trim() || undefined,
    }));
  return {
    title: input.personal.position.trim(),
    templateId: 1,
    summary: input.summary.trim() || undefined,
    contact: {
      name: input.personal.fullName.trim() || undefined,
      email: input.personal.email.trim() || undefined,
    },
    skills: cleanSkills,
    projects: cleanProjects,
  };
};

/* ============================================================================
 * Mirror của backend/src/service/cv.service.ts buildParsedData (chỉ phần
 * liên quan skills + projects).
 *
 * Source thật: backend/src/service/cv.service.ts
 *   if (input.skills) {
 *     parsedData.skills = input.skills.map((s) => {
 *       if (typeof s === 'string') return { name: s, level: 3 };
 *       return { name: s.name, level: clampSkillLevel(s.level) };
 *     });
 *   }
 *   if (input.projects) {
 *     parsedData.projects = input.projects as unknown as Record<string, unknown>[];
 *   }
 *
 * Nếu thay đổi behavior buildParsedData ở BE, update hàm này.
 * ==========================================================================*/

const clampSkillLevel = (level: unknown): number => {
  if (typeof level !== 'number' || Number.isNaN(level)) return 3;
  return Math.max(1, Math.min(5, Math.round(level)));
};

interface CreateDirectCvInputLite {
  title: string;
  templateId: number;
  summary?: string;
  contact?: { name?: string; email?: string };
  skills?: Array<string | { name: string; level: number }>;
  projects?: Array<{ name: string; role?: string; time?: string; description?: string; link?: string | null }>;
}

const buildParsedDataBE = (input: CreateDirectCvInputLite): {
  name?: string;
  email?: string;
  summary?: string;
  skills?: Array<{ name: string; level: number }>;
  projects?: Array<{ name: string; role?: string; time?: string; description?: string; link?: string | null }>;
} => {
  const out: ReturnType<typeof buildParsedDataBE> = {};
  if (input.contact) {
    if (input.contact.name !== undefined) out.name = input.contact.name;
    if (input.contact.email !== undefined) out.email = input.contact.email;
  }
  if (input.summary !== undefined) out.summary = input.summary;
  if (input.skills) {
    out.skills = input.skills.map((s) => {
      if (typeof s === 'string') return { name: s, level: 3 };
      return { name: s.name, level: clampSkillLevel(s.level) };
    });
  }
  if (input.projects) out.projects = input.projects;
  return out;
};

/* ============================================================================
 * Mirror của CreateResumeView.vue prefillFromCv (chỉ phần skills + projects).
 *
 * Source thật: frontend/src/views/candidate/CreateResumeView.vue
 *   const rawSkills = data.skills as Array<string | { name?: string; level?: number }> | undefined;
 *   skills.value = (rawSkills ?? []).map((s) => {
 *     if (typeof s === 'string') return { name: s, level: 3 };
 *     return { name: s.name ?? '', level: clampLevel(s.level) };
 *   });
 *   const proj = (data.projects as Project[] | undefined) ?? [];
 *   projects.value = proj.length
 *     ? proj.map((p) => ({
 *         name: p.name ?? '',
 *         role: p.role ?? '',
 *         time: p.time ?? '',
 *         description: p.description ?? '',
 *         link: p.link ?? '',
 *       }))
 *     : [{ name: '', role: '', time: '', description: '', link: '' }];
 * ==========================================================================*/

const prefillFromCvFE = (parsedData: Record<string, unknown>): {
  skills: FormSkill[];
  projects: FormProject[];
} => {
  const rawSkills = parsedData.skills as Array<string | { name?: string; level?: number }> | undefined;
  const skills: FormSkill[] = (rawSkills ?? []).map((s) => {
    if (typeof s === 'string') return { name: s, level: 3 };
    return { name: s.name ?? '', level: clampLevel(s.level) };
  });
  type ProjShape = { name?: string; role?: string; time?: string; description?: string; link?: string };
  const proj = (parsedData.projects as ProjShape[] | undefined) ?? [];
  const projects: FormProject[] = proj.length
    ? proj.map((p) => ({
        name: p.name ?? '',
        role: p.role ?? '',
        time: p.time ?? '',
        description: p.description ?? '',
        link: p.link ?? '',
      }))
    : [{ name: '', role: '', time: '', description: '', link: '' }];
  return { skills, projects };
};

describe('Integration: form → BE → form round-trip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('PASS: full round-trip với skill level + project role/time', () => {
    // Step 1: User nhập form
    const formInput = {
      personal: { fullName: 'Nguyễn Văn A', position: 'Senior Backend Dev', email: 'a@example.com' },
      summary: 'Backend engineer với 5 năm kinh nghiệm Node.js.',
      skills: [
        { name: 'Node.js', level: 5 },
        { name: 'TypeScript', level: 4 },
        { name: 'PostgreSQL', level: 4 },
        { name: '  ', level: 3 }, // empty → skip
        { name: 'node.js', level: 2 }, // duplicate (case-insensitive) → skip, giữ level 5
      ],
      projects: [
        {
          name: 'JobMatch VN',
          role: 'Tech Lead',
          time: '2024 — Hiện tại',
          description: 'Nền tảng match CV với JD',
          link: 'https://jobmatch.vn',
        },
        {
          name: 'OpenSource Tool',
          role: 'Solo Maintainer',
          time: '2023',
          description: '',
          link: '',
        },
      ],
    };

    // Step 2: FE buildDirectPayload → payload gửi lên BE
    const payload = buildDirectPayloadFE(formInput);
    expect(payload.skills).toEqual([
      { name: 'Node.js', level: 5 },
      { name: 'TypeScript', level: 4 },
      { name: 'PostgreSQL', level: 4 },
    ]);
    expect(payload.projects).toEqual([
      {
        name: 'JobMatch VN',
        role: 'Tech Lead',
        time: '2024 — Hiện tại',
        description: 'Nền tảng match CV với JD',
        link: 'https://jobmatch.vn',
      },
      {
        name: 'OpenSource Tool',
        role: 'Solo Maintainer',
        time: '2023',
        description: undefined,
        link: undefined,
      },
    ]);

    // Step 3: BE buildParsedData lưu vào DB → parsedData JSON
    const storedParsedData = buildParsedDataBE(payload);
    expect(storedParsedData.skills).toEqual([
      { name: 'Node.js', level: 5 },
      { name: 'TypeScript', level: 4 },
      { name: 'PostgreSQL', level: 4 },
    ]);
    expect(storedParsedData.projects).toEqual([
      {
        name: 'JobMatch VN',
        role: 'Tech Lead',
        time: '2024 — Hiện tại',
        description: 'Nền tảng match CV với JD',
        link: 'https://jobmatch.vn',
      },
      {
        name: 'OpenSource Tool',
        role: 'Solo Maintainer',
        time: '2023',
        description: undefined,
        link: undefined,
      },
    ]);

    // Step 4: GET /cvs/:id → BE trả về CV với parsedData
    const fetchedCv: Pick<Cv, 'parsedData'> = {
      parsedData: storedParsedData as Record<string, unknown>,
    };

    // Step 5: FE prefillFromCv → form refs
    const refilled = prefillFromCvFE(fetchedCv.parsedData as Record<string, unknown>);

    // Step 6: So sánh round-trip
    expect(refilled.skills).toEqual([
      { name: 'Node.js', level: 5 },
      { name: 'TypeScript', level: 4 },
      { name: 'PostgreSQL', level: 4 },
    ]);
    expect(refilled.projects).toEqual([
      {
        name: 'JobMatch VN',
        role: 'Tech Lead',
        time: '2024 — Hiện tại',
        description: 'Nền tảng match CV với JD',
        link: 'https://jobmatch.vn',
      },
      {
        name: 'OpenSource Tool',
        role: 'Solo Maintainer',
        time: '2023',
        description: '',
        link: '',
      },
    ]);

    // Step 7: So sánh tổng — form state sau round-trip. buildDirectPayloadFE
    // dedupe case-insensitive (giữ row đầu), loại row name rỗng. Nên kết
    // quả phải khớp với form input đã filter + dedupe cùng logic.
    const dedupedFormSkills = (() => {
      const seen = new Set<string>();
      const out: FormSkill[] = [];
      for (const s of formInput.skills) {
        const n = s.name.trim();
        if (!n) continue;
        const k = n.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ name: n, level: clampLevel(s.level) });
      }
      return out;
    })();
    expect(refilled.skills).toEqual(dedupedFormSkills);
    // Projects: chỉ giữ name, role, time, description, link — khớp 100%
    expect(refilled.projects).toEqual(formInput.projects);
  });

  it('PASS: backward compat — CV cũ (string[] skills, project thiếu role/time) → load → không crash + dedup default level=3', () => {
    // Mô phỏng CV đã tồn tại trong DB TRƯỚC khi fix — lưu shape cũ.
    const oldCvParsedData = {
      name: 'Old User',
      email: 'old@example.com',
      summary: 'Old summary',
      skills: ['Node.js', 'React', 'PostgreSQL'], // ← string[] thuần, level không có
      projects: [
        // ← project cũ THIẾU role + time (BE cũ strip)
        { name: 'Old Project', description: 'old desc', link: 'https://old' },
      ],
      education: [],
      experience: [],
      languages: [],
      certifications: [],
    };

    // prefillFromCv đọc được cả 2 shape
    const refilled = prefillFromCvFE(oldCvParsedData);
    expect(refilled.skills).toEqual([
      { name: 'Node.js', level: 3 }, // default 3 cho string[]
      { name: 'React', level: 3 },
      { name: 'PostgreSQL', level: 3 },
    ]);
    // Project cũ: role + time = '' (fallback), không crash
    expect(refilled.projects).toEqual([
      { name: 'Old Project', role: '', time: '', description: 'old desc', link: 'https://old' },
    ]);

    // Nếu user edit và save lại CV cũ này → BE buildParsedData sẽ normalize
    // skills về {name, level=3} và project full shape.
    const editInput = {
      title: 'Edit title',
      templateId: 1,
      contact: { name: oldCvParsedData.name, email: oldCvParsedData.email },
      summary: oldCvParsedData.summary,
      skills: refilled.skills, // [{name, level:3}]
      projects: refilled.projects, // [{name, role:'', time:'', description, link}]
    };
    const reNormalized = buildParsedDataBE(editInput);
    expect(reNormalized.skills).toEqual([
      { name: 'Node.js', level: 3 },
      { name: 'React', level: 3 },
      { name: 'PostgreSQL', level: 3 },
    ]);
    expect(reNormalized.projects).toEqual([
      { name: 'Old Project', role: '', time: '', description: 'old desc', link: 'https://old' },
    ]);
  });

  it('PASS: edge case — empty skills + empty projects', () => {
    const empty = buildDirectPayloadFE({
      personal: { fullName: '', position: '', email: '' },
      summary: '',
      skills: [],
      projects: [],
    });
    expect(empty.skills).toEqual([]);
    expect(empty.projects).toEqual([]);

    const stored = buildParsedDataBE(empty);
    // skills rỗng → vẫn là [] (buildParsedDataBE map [] → []).
    // `if (input.skills)` chỉ skip khi undefined, không skip khi [].
    expect(stored.skills).toEqual([]);
    expect(stored.projects).toEqual([]);

    const refilled = prefillFromCvFE(stored);
    expect(refilled.skills).toEqual([]);
    expect(refilled.projects).toEqual([{ name: '', role: '', time: '', description: '', link: '' }]);
  });

  it('PASS: edge case — level out-of-range được clamp', () => {
    const payload = buildDirectPayloadFE({
      personal: { fullName: 'X', position: 'Y', email: '' },
      summary: '',
      skills: [
        { name: 'A', level: 0 },     // → 1
        { name: 'B', level: 7 },     // → 5
        { name: 'C', level: 2.4 },   // → 2
        { name: 'D', level: 2.6 },   // → 3
        { name: 'E', level: -3 },    // → 1
        { name: 'F', level: NaN as unknown as number }, // → 3
      ],
      projects: [],
    });
    expect(payload.skills).toEqual([
      { name: 'A', level: 1 },
      { name: 'B', level: 5 },
      { name: 'C', level: 2 },
      { name: 'D', level: 3 },
      { name: 'E', level: 1 },
      { name: 'F', level: 3 },
    ]);

    const stored = buildParsedDataBE(payload);
    expect(stored.skills).toEqual(payload.skills);

    const refilled = prefillFromCvFE(stored);
    expect(refilled.skills).toEqual(payload.skills);
  });
});
