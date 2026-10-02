/**
 * cvLabels — nhãn section dùng chung cho 7 CV template (CVTemplate1-7).
 *
 * Mỗi template nhận prop `language: 'vi' | 'en'` (default 'en') rồi tra
 * bảng này để render tiêu đề ("Work Experience", "Kỹ năng", ...). Gom
 * dictionary về 1 chỗ để wording thống nhất giữa các template — không mỗi
 * template tự chế bản dịch riêng.
 *
 * Là nhãn HIỂN THỊ của CV (section heading), KHÔNG phải i18n UI của app.
 * Case không quan trọng với template dùng CSS text-transform: uppercase
 * (T1/T6/T7); các template còn lại dùng đúng case trong bảng.
 */
export type CvLanguage = 'vi' | 'en';

export type CvSectionKey =
  // Section headings chính
  | 'profile'
  | 'objective'
  | 'experience'
  | 'projects'
  | 'education'
  | 'skills'
  | 'certificates'
  | 'references'
  | 'activities'
  | 'interests'
  // Nhóm skill (T6: "PERSONAL" / "TECHNICAL")
  | 'personal'
  | 'technical'
  // Nhãn inline trong item (T4/T5: "Vai trò:", "Chuyên ngành:", "Nay")
  | 'role'
  | 'major'
  | 'present'
  // T6 "Date:" / T7 fallback "Degree"
  | 'dateLabel'
  | 'degree'
  // Fallback header khi thiếu data (T2 "Họ và Tên"/"Vị trí ứng tuyển")
  | 'fullName'
  | 'desiredPosition'
  // Fallback T6 (title + address heading)
  | 'curriculumVitae'
  | 'addressLocation';

export const CV_LABELS: Record<CvLanguage, Record<CvSectionKey, string>> = {
  en: {
    profile: 'Profile',
    objective: 'Career Objective',
    experience: 'Work Experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
    certificates: 'Certificates',
    references: 'References',
    activities: 'Activities',
    interests: 'Interests',
    personal: 'Personal',
    technical: 'Technical',
    role: 'Role',
    major: 'Major',
    present: 'Present',
    dateLabel: 'Date',
    degree: 'Degree',
    fullName: 'Full Name',
    desiredPosition: 'Desired Position',
    curriculumVitae: 'Curriculum Vitae',
    addressLocation: 'Address / Location',
  },
  vi: {
    profile: 'Giới thiệu',
    objective: 'Mục tiêu nghề nghiệp',
    experience: 'Kinh nghiệm làm việc',
    projects: 'Dự án',
    education: 'Học vấn',
    skills: 'Kỹ năng',
    certificates: 'Chứng chỉ',
    references: 'Người tham chiếu',
    activities: 'Hoạt động',
    interests: 'Sở thích',
    personal: 'Cá nhân',
    technical: 'Chuyên môn',
    role: 'Vai trò',
    major: 'Chuyên ngành',
    present: 'Nay',
    dateLabel: 'Ngày',
    degree: 'Bằng cấp',
    fullName: 'Họ và tên',
    desiredPosition: 'Vị trí ứng tuyển',
    curriculumVitae: 'Sơ yếu lý lịch',
    addressLocation: 'Địa chỉ',
  },
};
