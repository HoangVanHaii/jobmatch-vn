<script setup lang="ts">
/**
 * ProfileMockupView — Facebook-style profile mockup.
 *
 * Sections:
 *   - Top nav (logo + search bar)
 *   - Cover photo (gradient overlay with avatar overlay)
 *   - Profile card (avatar + name + tabs: Timeline / About / Friends / Photos)
 *   - About card (2-col grid: Work/School, Relationship/Location)
 *
 * Mockup only — không call API. Nếu muốn wire thì hỏi thêm.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useAuthStore } from '@stores/auth'
import { uploadApi } from '@services/upload.api'
import { useToastStore } from '@stores/toast'
import { useLocations } from '@composables/useLocations'
import { candidateApi } from '@services/candidate.api'
import type { CandidateProfile } from '@services/candidate.api'
import { Mail, Camera, Phone, User, GraduationCap, Heart, MapPin, Plus as PlusIcon, Globe, Pencil, Check, X, Briefcase, Linkedin, Github, ExternalLink, Calendar, Building2, Navigation, MapPinned, RotateCw, Home, Loader2, Facebook, Twitter, Youtube, Instagram, Share2, Trash2 } from 'lucide-vue-next'
import SocialRow from '@components/candidate/SocialRow.vue'

interface ProfileLink {
  type: 'link' | 'text'
  label: string
  value: string
}

interface ProfileAboutItem {
  icon: typeof User | typeof GraduationCap | typeof Heart | typeof MapPin | typeof Mail | typeof Phone | typeof Globe
  title: string
  subtitle?: string
  /** Optional link/text under subtitle (vd "Past: Lambo and BMW") */
  extra?: string
  /** Optional list of secondary links (vd Instagram, website) */
  links?: ProfileLink[]
  actionIcon?: 'plus' | 'none'
}

// ===== Wire API — lấy thông tin user hiện tại từ auth store =====
const auth = useAuthStore()

const profileName = computed(() => auth.user?.fullName?.trim() || 'Người dùng')
const profileAvatar = computed(() => auth.user?.avatarUrl || '')
const profileInitial = computed(() => profileName.value.charAt(0).toUpperCase())
const profileEmail = computed(() => auth.user?.email ?? '')

/** Cover photo + metadata load từ candidate profile (sau khi loadSavedAddress). */
const profileCoverUrl = computed(() => savedProfile.value?.coverUrl ?? null)
const profileSchool = ref<string>('')
const profileWork = ref<string>('')
/** Số điện thoại — mockup để rỗng để demo flow "Add phone". Có thể lấy từ user_profiles.phone khi backend có. */
const profilePhone = ref<string>('')

/** Birthday draft (DD / MM / YYYY format khi user nhập). Convert sang ISO YYYY-MM-DD trước khi save. */
const birthdayDraft = ref<string>('')
const birthdayError = ref<string>('')

/** Ngày sinh (YYYY-MM-DD) load từ candidate metadata. */
const profileBirthday = ref<string>('')

/** Province record khớp với location.city từ API (reverse-lookup khi reload). */
const loadedLocation = ref<{ city: string; district: string; address: string; lat: number | null; lng: number | null } | null>(null)

/** Full profile snapshot — dùng cho coverUrl + metadata. */
const savedProfile = ref<CandidateProfile | null>(null)

/** Saved social links (load từ API và cập nhật khi lưu). */
const savedSocial = ref<Record<string, string>>({
  linkedin: '',
  github: '',
  portfolio: '',
})

interface SocialItem {
  key: string
  label: string
  placeholder: string
  value: string
  icon: any
  isCustom?: boolean
}

/** Tự động chọn icon phù hợp theo tên mạng xã hội */
const getSocialIcon = (keyOrName: string) => {
  const k = keyOrName.toLowerCase()
  if (k.includes('linkedin')) return Linkedin
  if (k.includes('github') || k.includes('git')) return Github
  if (k.includes('facebook') || k.includes('fb')) return Facebook
  if (k.includes('twitter') || k.includes('tweet') || k === 'x') return Twitter
  if (k.includes('youtube') || k.includes('yt')) return Youtube
  if (k.includes('instagram') || k.includes('insta')) return Instagram
  return Globe
}

/** Format nhãn hiển thị cho mạng xã hội */
const formatSocialLabel = (key: string): string => {
  if (key === 'linkedin') return 'LinkedIn'
  if (key === 'github') return 'GitHub'
  if (key === 'portfolio') return 'Portfolio / Website'
  if (key === 'facebook') return 'Facebook'
  if (key === 'twitter') return 'Twitter / X'
  if (key === 'youtube') return 'YouTube'
  if (key === 'instagram') return 'Instagram'
  if (key === 'tiktok') return 'TikTok'
  return key
    .split(/[_-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Items cho tab Mạng xã hội — gồm các mục mặc định và các mục user tự thêm */
const socialItems = computed<SocialItem[]>(() => {
  const baseKeys = ['linkedin', 'github', 'portfolio']
  const items: SocialItem[] = [
    {
      key: 'linkedin',
      label: 'LinkedIn',
      placeholder: 'https://linkedin.com/in/ten-cua-ban',
      value: savedSocial.value.linkedin || '',
      icon: Linkedin,
      isCustom: false,
    },
    {
      key: 'github',
      label: 'GitHub',
      placeholder: 'https://github.com/ten-cua-ban',
      value: savedSocial.value.github || '',
      icon: Github,
      isCustom: false,
    },
    {
      key: 'portfolio',
      label: 'Portfolio / Website',
      placeholder: 'https://trang-cua-ban.com',
      value: savedSocial.value.portfolio || '',
      icon: Globe,
      isCustom: false,
    },
  ]

  // Thêm các mạng xã hội tùy chỉnh khác từ savedSocial
  for (const [k, val] of Object.entries(savedSocial.value)) {
    if (!baseKeys.includes(k) && val) {
      items.push({
        key: k,
        label: formatSocialLabel(k),
        placeholder: 'https://...',
        value: val,
        icon: getSocialIcon(k),
        isCustom: true,
      })
    }
  }

  return items
})

const socialLeft = computed(() => {
  return socialItems.value.filter((item) => {
    if (item.key === 'linkedin' || item.key === 'github') return true
    if (item.key === 'portfolio') return false
    const customList = socialItems.value.filter((s) => s.isCustom)
    const customIdx = customList.indexOf(item)
    return customIdx % 2 === 0
  })
})

const socialRight = computed(() => {
  return socialItems.value.filter((item) => {
    if (item.key === 'portfolio') return true
    if (item.key === 'linkedin' || item.key === 'github') return false
    const customList = socialItems.value.filter((s) => s.isCustom)
    const customIdx = customList.indexOf(item)
    return customIdx % 2 === 1
  })
})

/** Số lượng tài khoản mạng xã hội đã liên kết. */
const socialCount = computed(() => {
  const count = Object.values(savedSocial.value).filter(Boolean).length
  return count > 0 ? count : undefined
})

/** Rút gọn URL hiển thị (bỏ protocol + trailing slash). */
const shortUrl = (url: string): string =>
  url.replace(/^https?:\/\//, '').replace(/\/$/, '')

// ===== Inline edit cho Mạng xã hội tab =====
const editingSocialKey = ref<string | null>(null)
const socialDraft = ref<string>('')

const startEditSingleSocial = (key: string, currentValue?: string): void => {
  editingSocialKey.value = key
  socialDraft.value = currentValue ?? ''
}

const cancelEditSingleSocial = (): void => {
  editingSocialKey.value = null
  socialDraft.value = ''
}

const saveSingleSocial = async (key: string): Promise<void> => {
  let val = socialDraft.value.trim()
  if (val && !/^https?:\/\//i.test(val)) {
    val = `https://${val}`
  }
  if (val) {
    try {
      new URL(val)
    } catch {
      toast.push({
        variant: 'error',
        title: 'URL không hợp lệ',
        body: 'Vui lòng nhập đường dẫn hợp lệ (ví dụ: https://...)',
      })
      return
    }
  }

  try {
    await candidateApi.updateProfile({
      social: {
        [key]: val,
      },
    })
    if (!val && !['linkedin', 'github', 'portfolio'].includes(key)) {
      const updated = { ...savedSocial.value }
      delete updated[key]
      savedSocial.value = updated
    } else {
      savedSocial.value = {
        ...savedSocial.value,
        [key]: val,
      }
    }
    cancelEditSingleSocial()
    toast.push({ variant: 'success', title: 'Đã cập nhật mạng xã hội' })
    await loadSavedAddress()
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Cập nhật thất bại',
      body: err instanceof Error ? err.message : 'Vui lòng thử lại',
    })
  }
}

// ===== Thêm loại mạng xã hội khác (2 ô: Tên mạng xh + Links) =====
const isAddingSocial = ref(false)
const newSocialName = ref('')
const newSocialUrl = ref('')
const addingSocialLoading = ref(false)
const socialNameInputRef = ref<HTMLInputElement | null>(null)
const socialUrlInputRef = ref<HTMLInputElement | null>(null)

const startAddSocial = async (): Promise<void> => {
  newSocialName.value = ''
  newSocialUrl.value = ''
  isAddingSocial.value = true
  await nextTick()
  socialNameInputRef.value?.focus()
}

const onSocialNameEnter = (): void => {
  if (!newSocialUrl.value.trim()) {
    socialUrlInputRef.value?.focus()
  } else {
    saveNewSocial()
  }
}

const cancelAddSocial = (): void => {
  isAddingSocial.value = false
  newSocialName.value = ''
  newSocialUrl.value = ''
}

const saveNewSocial = async (): Promise<void> => {
  const name = newSocialName.value.trim()
  let url = newSocialUrl.value.trim()

  if (!name) {
    toast.push({
      variant: 'error',
      title: 'Thiếu tên mạng xã hội',
      body: 'Vui lòng nhập tên mạng xã hội (ví dụ: Facebook, TikTok, YouTube...)',
    })
    return
  }

  if (!url) {
    toast.push({
      variant: 'error',
      title: 'Thiếu liên kết',
      body: 'Vui lòng nhập đường dẫn URL liên kết',
    })
    return
  }

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }

  try {
    new URL(url)
  } catch {
    toast.push({
      variant: 'error',
      title: 'URL không hợp lệ',
      body: 'Vui lòng nhập đường dẫn hợp lệ (ví dụ: https://...)',
    })
    return
  }

  // Chuẩn hóa tên thành key lưu vào social
  const key = name.toLowerCase().replace(/[\s\-_]+/g, '_').replace(/[^a-z0-9_]/g, '') || `social_${Date.now()}`

  addingSocialLoading.value = true
  try {
    await candidateApi.updateProfile({
      social: {
        [key]: url,
      },
    })
    savedSocial.value = {
      ...savedSocial.value,
      [key]: url,
    }
    cancelAddSocial()
    toast.push({
      variant: 'success',
      title: 'Đã thêm mạng xã hội',
      body: `${name}: ${shortUrl(url)}`,
    })
    await loadSavedAddress()
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Thêm mạng xã hội thất bại',
      body: err instanceof Error ? err.message : 'Vui lòng thử lại',
    })
  } finally {
    addingSocialLoading.value = false
  }
}

/** Xóa mạng xã hội tùy chỉnh */
const deleteSocial = async (key: string, label: string): Promise<void> => {
  try {
    await candidateApi.updateProfile({
      social: {
        [key]: '',
      },
    })
    const updated = { ...savedSocial.value }
    delete updated[key]
    savedSocial.value = updated
    toast.push({
      variant: 'success',
      title: 'Đã xóa mạng xã hội',
      body: `Đã xóa liên kết ${label}`,
    })
    await loadSavedAddress()
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Xóa thất bại',
      body: err instanceof Error ? err.message : 'Vui lòng thử lại',
    })
  }
}

// ===== Inline edit cho Thông tin tab =====
const editingItemKey = ref<string | null>(null)
const itemDraft = ref<string>('')

const startEditItem = (column: 'left' | 'right', index: number, currentValue?: string): void => {
  editingItemKey.value = `${column}-${index}`
  itemDraft.value = currentValue ?? ''
  // Birthday (right-2) dùng DD / MM / YYYY → fill cả 2 draft
  if (column === 'right' && index === 2) {
    birthdayDraft.value = formatBirthday(currentValue ?? '')
    birthdayError.value = ''
  }
}

const cancelEditItem = (): void => {
  editingItemKey.value = null
  itemDraft.value = ''
  birthdayDraft.value = ''
  birthdayError.value = ''
}

const saveItem = async (column: 'left' | 'right', index: number): Promise<void> => {
  // School (left-1) / Work (left-2) → save via metadata JSONB
  if (column === 'left' && (index === 1 || index === 2)) {
    const field = index === 1 ? 'school' : 'work'
    try {
      await candidateApi.updateProfile({
        metadata: { [field]: itemDraft.value.trim() },
      })
      cancelEditItem()
      toast.push({ variant: 'success', title: 'Đã cập nhật' })
      await loadSavedAddress()
    } catch (err: unknown) {
      toast.push({
        variant: 'error',
        title: 'Cập nhật thất bại',
        body: err instanceof Error ? err.message : 'Vui lòng thử lại',
      })
    }
    return
  }
  // Birthday (right-2) → save via metadata (DD / MM / YYYY → YYYY-MM-DD)
  if (column === 'right' && index === 2) {
    const trimmed = birthdayDraft.value.trim()
    if (!trimmed) {
      try {
        await candidateApi.updateProfile({
          metadata: { birthday: undefined },
        })
        cancelEditItem()
        toast.push({ variant: 'success', title: 'Đã cập nhật' })
        await loadSavedAddress()
      } catch (err: unknown) {
        toast.push({
          variant: 'error',
          title: 'Cập nhật thất bại',
          body: err instanceof Error ? err.message : 'Vui lòng thử lại',
        })
      }
      return
    }
    const err = validateBirthdayDraft(trimmed)
    if (err) {
      toast.push({ variant: 'error', title: 'Ngày sinh không hợp lệ', body: err })
      return
    }
    const iso = birthdayDraftToIso(trimmed)
    if (!iso) {
      toast.push({
        variant: 'error',
        title: 'Ngày sinh không hợp lệ',
        body: 'Định dạng bắt buộc: Ngày / Tháng / Năm (ví dụ: 12 / 06 / 2005)',
      })
      return
    }
    try {
      await candidateApi.updateProfile({
        metadata: { birthday: iso },
      })
      cancelEditItem()
      toast.push({ variant: 'success', title: 'Đã cập nhật' })
      await loadSavedAddress()
    } catch (err: unknown) {
      toast.push({
        variant: 'error',
        title: 'Cập nhật thất bại',
        body: err instanceof Error ? err.message : 'Vui lòng thử lại',
      })
    }
    return
  }
  try {
    const payload = updatePayloadForItem(column, index, itemDraft.value.trim())
    await candidateApi.updateProfile(payload)
    cancelEditItem()
    toast.push({ variant: 'success', title: 'Đã cập nhật' })
    // Reload để sync state từ server (tránh mutate proxy + có data mới nhất)
    await loadSavedAddress()
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Cập nhật thất bại',
      body: err instanceof Error ? err.message : 'Vui lòng thử lại',
    })
  }
}

// ===== Add new item inline =====
const addingItemKey = ref<string | null>(null)
const addDraft = ref<string>('')

const startAddItem = (column: 'left' | 'right', index: number): void => {
  if (column === 'right' && index === 2) {
    startEditItem('right', 2, '')
    return
  }
  addingItemKey.value = `${column}-${index}`
  addDraft.value = ''
}

const cancelAddItem = (): void => {
  addingItemKey.value = null
  addDraft.value = ''
}

/** Lưu item mới — route theo column/index tới API tương ứng. */
const saveAddItem = async (column: 'left' | 'right', index: number): Promise<void> => {
  const value = addDraft.value.trim()
  // left-1 = school, left-2 = work (metadata JSONB)
  if (column === 'left' && (index === 1 || index === 2)) {
    const field = index === 1 ? 'school' : 'work'
    try {
      await candidateApi.updateProfile({ metadata: { [field]: value } })
      cancelAddItem()
      toast.push({ variant: 'success', title: 'Đã thêm' })
      await loadSavedAddress()
    } catch (err: unknown) {
      toast.push({
        variant: 'error',
        title: 'Thêm thất bại',
        body: err instanceof Error ? err.message : 'Vui lòng thử lại',
      })
    }
    return
  }
  // right-1 = phone
  if (column === 'right' && index === 1) {
    try {
      await candidateApi.updateProfile({ phone: value || undefined })
      cancelAddItem()
      toast.push({ variant: 'success', title: 'Đã thêm' })
      await loadSavedAddress()
    } catch (err: unknown) {
      toast.push({
        variant: 'error',
        title: 'Thêm thất bại',
        body: err instanceof Error ? err.message : 'Vui lòng thử lại',
      })
    }
    return
  }
  // right-2 = birthday (metadata)
  if (column === 'right' && index === 2) {
    const iso = birthdayDraftToIso(value)
    if (value && !iso) {
      toast.push({
        variant: 'error',
        title: 'Ngày sinh không hợp lệ',
        body: 'Định dạng Ngày / Tháng / Năm (ví dụ: 12 / 06 / 2005)',
      })
      return
    }
    try {
      await candidateApi.updateProfile({
        metadata: { birthday: iso || undefined },
      })
      cancelAddItem()
      toast.push({ variant: 'success', title: 'Đã thêm' })
      await loadSavedAddress()
    } catch (err: unknown) {
      toast.push({
        variant: 'error',
        title: 'Thêm thất bại',
        body: err instanceof Error ? err.message : 'Vui lòng thử lại',
      })
    }
    return
  }
  // Các item khác chưa có API
  toast.push({
    variant: 'error',
    title: 'Chưa hỗ trợ',
    body: 'Tính năng này đang phát triển',
  })
  cancelAddItem()
}

/** Map (column, index) → API payload để cập nhật field đó. */
const updatePayloadForItem = (
  column: 'left' | 'right',
  index: number,
  value: string,
): { fullName?: string; phone?: string } => {
  // Left column items: index 0 = Họ tên (fullName).
  //                   index 1 = Trường học / index 2 = Nơi làm việc → metadata, xử lý riêng.
  // Right column items: index 0 = Email (chưa có API update) → skip.
  //                     index 1 = Phone (phone field).
  if (column === 'left' && index === 0) {
    return { fullName: value }
  }
  if (column === 'right' && index === 1) {
    return { phone: value }
  }
  // Email + school + work + extras chưa support update payload dạng này
  toast.push({
    variant: 'error',
    title: 'Chưa hỗ trợ',
    body: 'Tính năng này đang phát triển',
  })
  throw new Error('Not implemented')
}

// ===== Address tab state & handlers =====
const isEditingAddress = ref(false)
const savingAddress = ref(false)
const geocodingLoading = ref(false)

const draftProvinceCode = ref<number | null>(null)
const draftDistrictCode = ref<number | null>(null)
const draftStreet = ref<string>('')

const savedProvinceCode = ref<number | null>(79) // Mặc định TP.HCM (code 79)
const savedDistrictCode = ref<number | null>(null)
const savedStreet = ref<string>('')

// Tọa độ & Map preview
const pickedLat = ref<number | null>(null)
const pickedLng = ref<number | null>(null)
const previewBbox = ref<string | null>(null)
const previewMarker = ref<string | null>(null)

// useLocations: fetch provinces + districts qua API provinces.open-api.vn
const {
  items: provinces,
  loading: locationsLoading,
  fetch: fetchLocations,
  getDistricts,
} = useLocations()

const provinceName = (code: number | null): string => {
  if (!code) return ''
  return provinces.value.find((p) => p.code === code)?.name ?? ''
}

const districtName = (provinceCode: number | null, districtCode: number | null): string => {
  if (!provinceCode || !districtCode) return ''
  return getDistricts(provinceCode).find((d) => d.code === districtCode)?.name ?? ''
}

/** Districts thuộc province đang chọn — lấy từ API provinces.open-api.vn/api/v1/d/ */
const availableDistricts = computed(() => {
  const code = isEditingAddress.value ? draftProvinceCode.value : savedProvinceCode.value
  return code ? getDistricts(code) : []
})

/** Chuỗi địa chỉ đầy đủ ghép từ các trường */
const fullAddressString = computed(() => {
  const parts = [
    savedStreet.value,
    districtName(savedProvinceCode.value, savedDistrictCode.value),
    provinceName(savedProvinceCode.value),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : ''
})

/** Bắt đầu chỉnh sửa: call API ngoài provinces.open-api.vn nếu chưa có */
const startEditAddress = async (): Promise<void> => {
  if (provinces.value.length === 0) {
    await fetchLocations()
  }
  draftProvinceCode.value = savedProvinceCode.value
  draftDistrictCode.value = savedDistrictCode.value
  draftStreet.value = savedStreet.value
  isEditingAddress.value = true
}

const cancelEditAddress = (): void => {
  isEditingAddress.value = false
  draftProvinceCode.value = savedProvinceCode.value
  draftDistrictCode.value = savedDistrictCode.value
  draftStreet.value = savedStreet.value
}

/** Khi đổi tỉnh/thành phố: reset quận/huyện để user chọn lại từ API */
const onProvinceChange = (): void => {
  draftDistrictCode.value = null
}

/** Gọi Photon Geocoding API để kiểm tra địa chỉ và lấy tọa độ chính xác */
const previewAddressOnMap = async (): Promise<void> => {
  if (!draftProvinceCode.value) {
    toast.push({
      variant: 'error',
      title: 'Chưa chọn Tỉnh / Thành phố',
      body: 'Vui lòng chọn ít nhất Tỉnh / Thành phố để kiểm tra vị trí',
    })
    return
  }

  const province = provinceName(draftProvinceCode.value)
  const district = districtName(draftProvinceCode.value, draftDistrictCode.value)
  const street = draftStreet.value.trim()

  const queries = [
    [street, district, province, 'Vietnam'].filter(Boolean).join(', '),
    [street, district, province].filter(Boolean).join(', '),
    [district, province, 'Vietnam'].filter(Boolean).join(', '),
    [district, province].filter(Boolean).join(', '),
    [province, 'Vietnam'].filter(Boolean).join(', '),
  ].filter((q) => q.length > 0)

  geocodingLoading.value = true
  try {
    for (const q of queries) {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`
      const res = await fetch(url)
      if (!res.ok) continue
      const data = (await res.json()) as {
        features?: Array<{
          geometry: { coordinates: [number, number] }
          properties?: { name?: string; extent?: [number, number, number, number] }
        }>
      }
      const features = data.features ?? []
      if (features.length === 0) continue

      const f = features[0]
      const [lon, lat] = f.geometry.coordinates
      let minLon: number, minLat: number, maxLon: number, maxLat: number
      if (f.properties?.extent && f.properties.extent.length === 4) {
        ;[minLon, minLat, maxLon, maxLat] = f.properties.extent
      } else {
        const pad = 0.005
        minLon = lon - pad
        minLat = lat - pad
        maxLon = lon + pad
        maxLat = lat + pad
      }
      pickedLat.value = lat
      pickedLng.value = lon
      previewBbox.value = `${minLon},${minLat},${maxLon},${maxLat}`
      previewMarker.value = `${lat},${lon}`

      const locationLabel = [street, district, province].filter(Boolean).join(', ')
      toast.push({
        variant: 'success',
        title: 'Đã tìm thấy tọa độ!',
        body: `${lat.toFixed(4)}, ${lon.toFixed(4)} — ${f.properties?.name || locationLabel}`,
      })
      return
    }

    toast.push({
      variant: 'error',
      title: 'Không tìm thấy tọa độ chính xác',
      body: 'Không thể định vị được địa chỉ này trên bản đồ. Bạn có thể kiểm tra lại tên đường hoặc quận/huyện.',
    })
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Lỗi định vị bản đồ',
      body: err instanceof Error ? err.message : 'Vui lòng thử lại sau',
    })
  } finally {
    geocodingLoading.value = false
  }
}

/** Lưu địa chỉ vào backend sau khi đã chọn tỉnh, quận, đường và lấy tọa độ */
const saveAddress = async (): Promise<void> => {
  if (!draftProvinceCode.value) {
    toast.push({
      variant: 'error',
      title: 'Chưa chọn Tỉnh / Thành phố',
      body: 'Vui lòng chọn Tỉnh / Thành phố trước khi lưu',
    })
    return
  }

  savingAddress.value = true
  try {
    const city = provinceName(draftProvinceCode.value)
    const district = districtName(draftProvinceCode.value, draftDistrictCode.value)
    const address = draftStreet.value.trim()

    // Nếu chưa có tọa độ, tự động kiểm tra và lấy tọa độ trước khi lưu
    if (pickedLat.value === null || pickedLng.value === null) {
      await previewAddressOnMap()
    }

    // PATCH /candidates/profile — backend lưu vào candidates.location (JSONB)
    await candidateApi.updateProfile({
      location: {
        city,
        district: district || '',
        address: address || '',
        lat: pickedLat.value ?? undefined,
        lng: pickedLng.value ?? undefined,
      },
    })

    savedProvinceCode.value = draftProvinceCode.value
    savedDistrictCode.value = draftDistrictCode.value
    savedStreet.value = address

    loadedLocation.value = {
      city,
      district,
      address,
      lat: pickedLat.value,
      lng: pickedLng.value,
    }

    isEditingAddress.value = false
    toast.push({
      variant: 'success',
      title: 'Đã lưu địa chỉ thành công',
      body: [address, district, city].filter(Boolean).join(', '),
    })
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Lưu địa chỉ thất bại',
      body: err instanceof Error ? err.message : 'Vui lòng thử lại',
    })
  } finally {
    savingAddress.value = false
  }
}

/** Định vị lại trên thẻ bản đồ */
const refreshMapLocation = async (): Promise<void> => {
  draftProvinceCode.value = savedProvinceCode.value
  draftDistrictCode.value = savedDistrictCode.value
  draftStreet.value = savedStreet.value
  await previewAddressOnMap()
  if (pickedLat.value !== null && pickedLng.value !== null) {
    try {
      await candidateApi.updateProfile({
        location: {
          lat: pickedLat.value,
          lng: pickedLng.value,
        },
      })
    } catch {
      // ignore
    }
  }
}

/** Load saved location từ API + reverse-lookup province code từ city name */
const loadSavedAddress = async (): Promise<void> => {
  try {
    const { data } = await candidateApi.getProfile()
    savedProfile.value = data.data ?? null
    const meta = data.data?.metadata
    profileSchool.value = meta?.school ?? ''
    profileWork.value = meta?.work ?? ''
    profileBirthday.value = meta?.birthday ?? ''
    profilePhone.value = data.data?.phone ?? ''
    const loc = data.data?.location
    const cityName = loc?.city
    const districtNameVal = loc?.district ?? ''

    if (cityName !== undefined && cityName !== null) {
      const cityKey = cityName
      loadedLocation.value = {
        city: cityKey,
        district: districtNameVal,
        address: loc?.address ?? '',
        lat: typeof loc?.lat === 'number' ? loc.lat : null,
        lng: typeof loc?.lng === 'number' ? loc.lng : null,
      }
      savedStreet.value = loc?.address ?? ''
      pickedLat.value = typeof loc?.lat === 'number' ? loc.lat : null
      pickedLng.value = typeof loc?.lng === 'number' ? loc.lng : null

      if (provinces.value.length === 0) {
        await fetchLocations()
      }
      const matchedProvince = provinces.value.find(
        (p) => p.name.toLowerCase() === cityKey.toLowerCase(),
      )
      if (matchedProvince) {
        savedProvinceCode.value = matchedProvince.code
        const matchedDistrict = getDistricts(matchedProvince.code).find(
          (d) => d.name.toLowerCase() === districtNameVal.toLowerCase(),
        )
        if (matchedDistrict) savedDistrictCode.value = matchedDistrict.code
      }
    }

    const social = data.data?.social as Record<string, string> | null
    savedSocial.value = {
      linkedin: '',
      github: '',
      portfolio: '',
      ...(social || {}),
    }

    if (pickedLat.value !== null && pickedLng.value !== null) {
      const pad = 0.005
      previewBbox.value = `${pickedLng.value - pad},${pickedLat.value - pad},${pickedLng.value + pad},${pickedLat.value + pad}`
      previewMarker.value = `${pickedLat.value},${pickedLng.value}`
    }
  } catch (err) {
    console.warn('[ProfileMockup] loadSavedAddress failed:', err)
  }
}

onMounted(() => {
  void loadSavedAddress()
})

/** Role tiếng Việt cho hiển thị */
const profileRoleLabel = computed(() => {
  const role = auth.user?.role
  if (role === 'employer') return 'Nhà tuyển dụng'
  if (role === 'admin') return 'Quản trị viên'
  return 'Ứng viên'
})

// ===== Cover image upload =====
const DEFAULT_COVER =
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1400&q=80'
const coverInputEl = ref<HTMLInputElement | null>(null)
const uploadingCover = ref(false)

/** Click "Edit Cover" → trigger file picker. */
const onPickCover = (): void => {
  coverInputEl.value?.click()
}

const onCoverFileChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  uploadingCover.value = true
  try {
    const result = await uploadApi.uploadImage(file, 'covers')
    const coverUrl = result.data.data.url
    // PATCH /candidates/profile → backend lưu vào user_profiles.cover_url
    await candidateApi.updateProfile({ coverUrl })
    // Reload để sync savedProfile → template re-render với ảnh mới
    await loadSavedAddress()
    toast.push({ variant: 'success', title: 'Đã cập nhật ảnh bìa' })
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Upload ảnh bìa thất bại',
      body: err instanceof Error ? err.message : 'Vui lòng thử lại',
    })
  } finally {
    uploadingCover.value = false
    target.value = ''
  }
}

// ===== Avatar upload (click avatar → file picker → uploadApi → changeAvatar) =====
const toast = useToastStore()

const uploadingAvatar = ref(false)
const avatarInputEl = ref<HTMLInputElement | null>(null)

/** Click avatar → trigger file picker. */
const onPickAvatar = (): void => {
  avatarInputEl.value?.click()
}

const onAvatarFileChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  uploadingAvatar.value = true
  try {
    const result = await uploadApi.uploadImage(file, 'avatars')
    const avatarUrl = result.data.data.url
    // Cập nhật auth.user.avatarUrl để mọi view phản ánh thay đổi.
    if (auth.user) {
      auth.user = { ...auth.user, avatarUrl }
    }
    toast.push({ variant: 'success', title: 'Đã cập nhật ảnh đại diện', body: file.name })
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Upload ảnh đại diện thất bại',
      body: err instanceof Error ? err.message : 'Vui lòng thử lại',
    })
  } finally {
    uploadingAvatar.value = false
    target.value = ''
  }
}

/** Reactive aboutLeft items — auto-sync từ profileName/School/Work refs. */
const aboutLeft = ref<ProfileAboutItem[]>([
  {
    icon: User,
    title: 'Họ tên',
    subtitle: '',
  },
  {
    icon: GraduationCap,
    title: 'Trường học',
    subtitle: '',
    actionIcon: 'plus',
  },
  {
    icon: Briefcase,
    title: 'Nơi làm việc',
    subtitle: '',
    actionIcon: 'plus',
  },
])

// Sync aboutLeft items với các ref tương ứng mỗi khi chúng thay đổi.
watch(
  [profileName, profileSchool, profileWork],
  ([name, school, work]: [string, string, string]) => {
    aboutLeft.value[0].subtitle = name
    aboutLeft.value[1].subtitle = school
    aboutLeft.value[2].subtitle = work
  },
  { immediate: true },
)

const aboutRight = ref<ProfileAboutItem[]>([
  {
    icon: Mail,
    title: 'Email',
    subtitle: profileEmail.value,
  },
  {
    icon: Phone,
    title: "Số điện thoại",
    subtitle: profilePhone.value,
    actionIcon: profilePhone.value ? undefined : 'plus',
  },
  {
    icon: Calendar,
    title: 'Ngày sinh',
    subtitle: profileBirthday.value,
    actionIcon: 'plus',
  },
])

// Sync phone vào aboutRight (index 1) — giữ title "Số điện thoại" cố định.
watch(
  profilePhone,
  (phone) => {
    if (aboutRight.value[1]) {
      aboutRight.value[1].subtitle = phone
      aboutRight.value[1].actionIcon = phone ? undefined : 'plus'
    }
  },
  { immediate: true },
)

/** Format YYYY-MM-DD → DD / MM / YYYY cho hiển thị tiếng Việt. */
const formatBirthday = (iso: string): string => {
  if (!iso) return ''
  const trimmed = iso.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-')
    return `${d} / ${m} / ${y}`
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 8) {
    if (/^(19|20)\d{6}$/.test(digits) && !trimmed.includes('/')) {
      return `${digits.slice(6, 8)} / ${digits.slice(4, 6)} / ${digits.slice(0, 4)}`
    }
    return `${digits.slice(0, 2)} / ${digits.slice(2, 4)} / ${digits.slice(4, 8)}`
  }
  return iso
}

/** Kiểm tra tính hợp lệ của ngày sinh theo định dạng Ngày / Tháng / Năm */
const validateBirthdayDraft = (draft: string): string => {
  const digits = draft.replace(/\D/g, '')
  if (!digits) return ''

  if (digits.length >= 2) {
    const day = parseInt(digits.slice(0, 2), 10)
    if (day < 1 || day > 31) return 'Ngày không hợp lệ (từ 01 đến 31)'
  }

  if (digits.length >= 4) {
    const day = parseInt(digits.slice(0, 2), 10)
    const month = parseInt(digits.slice(2, 4), 10)
    if (month < 1 || month > 12) {
      return 'Tháng không thể lớn hơn 12. Định dạng: Ngày / Tháng / Năm'
    }
    if ([4, 6, 9, 11].includes(month) && day > 30) {
      return `Tháng ${month} chỉ có tối đa 30 ngày`
    }
    if (month === 2 && day > 29) {
      return 'Tháng 2 chỉ có tối đa 29 ngày'
    }
  }

  if (digits.length === 8) {
    const day = parseInt(digits.slice(0, 2), 10)
    const month = parseInt(digits.slice(2, 4), 10)
    const year = parseInt(digits.slice(4, 8), 10)
    const currentYear = new Date().getFullYear()
    if (year < 1900) return 'Năm sinh không hợp lệ (từ 1900 trở đi)'
    if (year > currentYear) return `Năm sinh không thể lớn hơn ${currentYear}`
    const daysInMonth = new Date(year, month, 0).getDate()
    if (day > daysInMonth) {
      return `Tháng ${month}/${year} chỉ có ${daysInMonth} ngày`
    }
  }
  return ''
}

/** Auto-format DD / MM / YYYY khi user nhập:
 *  - Tự động chèn ' / ' sau ngày và tháng (ví dụ: 12 / 06 / 2005)
 *  - Chỉ cho phép nhập số
 *  - Giới hạn tối đa 8 số
 */
const onBirthdayInput = (e: Event): void => {
  const target = e.target as HTMLInputElement
  const raw = target.value.replace(/\D/g, '').slice(0, 8)

  let formatted = ''
  if (raw.length === 0) {
    formatted = ''
  } else if (raw.length <= 2) {
    formatted = raw
  } else if (raw.length <= 4) {
    formatted = `${raw.slice(0, 2)} / ${raw.slice(2)}`
  } else {
    formatted = `${raw.slice(0, 2)} / ${raw.slice(2, 4)} / ${raw.slice(4)}`
  }

  target.value = formatted
  birthdayDraft.value = formatted
  birthdayError.value = validateBirthdayDraft(formatted)
}

/** Hỗ trợ gõ phím '/' hoặc '-' tiện lợi:
 *  Ví dụ gõ '5' rồi gõ '/' -> tự chuyển thành '05 / '
 *  Ví dụ gõ '12 / 6' rồi gõ '/' -> tự chuyển thành '12 / 06 / '
 */
const onBirthdayKeydown = (e: KeyboardEvent): void => {
  if (e.key === '/' || e.key === '-') {
    const target = e.target as HTMLInputElement
    const raw = target.value.replace(/\D/g, '')
    if (raw.length === 1) {
      e.preventDefault()
      const val = `0${raw} / `
      target.value = val
      birthdayDraft.value = val
      birthdayError.value = ''
    } else if (raw.length === 3) {
      e.preventDefault()
      const val = `${raw.slice(0, 2)} / 0${raw.slice(2)} / `
      target.value = val
      birthdayDraft.value = val
      birthdayError.value = ''
    }
  }
}

/** Convert DD / MM / YYYY → YYYY-MM-DD (ISO). Trả về '' nếu invalid. */
const birthdayDraftToIso = (draft: string): string => {
  const digits = draft.replace(/\D/g, '')
  if (digits.length !== 8) return ''
  const err = validateBirthdayDraft(draft)
  if (err) return ''
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  return `${yyyy}-${mm}-${dd}`
}

// Sync birthday vào aboutRight (index 2) — title "Ngày sinh" cố định.
watch(
  profileBirthday,
  (birthday) => {
    if (aboutRight.value[2]) {
      aboutRight.value[2].subtitle = formatBirthday(birthday)
      aboutRight.value[2].actionIcon = birthday ? undefined : 'plus'
    }
  },
  { immediate: true },
)

type ProfileTab = 'Thông tin' | 'Địa chỉ' | 'Mạng xã hội' | 'Hồ sơ nghề nghiệp'
const activeProfileTab = ref<ProfileTab>('Thông tin')
const profileTabs: readonly ProfileTab[] = [
  'Thông tin',
  'Địa chỉ',
  'Mạng xã hội',
  'Hồ sơ nghề nghiệp',
]

/** Mức độ hoàn thiện hồ sơ — tham khảo ProfileView để đồng bộ trọng số.
 *  Tổng 100%: fullName (20) + phone (15) + avatar (15) + city (10) + district (10) + social (10 mỗi, max 30). */
const completionPercentage = computed(() => {
  const p = savedProfile.value
  let earned = 0
  if (p?.fullName?.trim()) earned += 20
  if (p?.phone?.trim()) earned += 15
  if (profileAvatar.value) earned += 15
  if (p?.location?.city?.trim()) earned += 10
  if (p?.location?.district?.trim()) earned += 10
  if (p?.social?.linkedin?.trim()) earned += 10
  if (p?.social?.github?.trim()) earned += 10
  if (p?.social?.portfolio?.trim()) earned += 10
  return Math.min(100, earned)
})

/** Tone màu theo mức hoàn thiện: <30 đỏ, 30-69 cam, 70-89 vàng, ≥90 xanh lá.
 *  Bám theo displayedCompletion (số đang chạy) để đổi màu mượt khi count-up đi qua ngưỡng. */
const completionColorClass = computed(() => {
  const p = displayedCompletion.value
  if (p < 30) {
    return { text: 'text-rose-600', bar: 'bg-rose-500' }
  }
  if (p < 70) {
    return { text: 'text-orange-600', bar: 'bg-orange-500' }
  }
  if (p < 90) {
    return { text: 'text-amber-600', bar: 'bg-amber-500' }
  }
  return { text: 'text-emerald-600', bar: 'bg-emerald-500' }
})

/** Số % hiển thị — chạy count-up animation từ giá trị cũ → giá trị mới khi load/reload. */
const displayedCompletion = ref(0)
let completionRafId: number | null = null

const animateCompletion = (from: number, to: number): void => {
  if (completionRafId !== null) {
    cancelAnimationFrame(completionRafId)
    completionRafId = null
  }
  const start = performance.now()
  const duration = 1500
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / duration)
    // easeOutCubic cho cảm giác mượt
    const eased = 1 - Math.pow(1 - t, 3)
    displayedCompletion.value = Math.round(from + (to - from) * eased)
    if (t < 1) {
      completionRafId = requestAnimationFrame(tick)
    } else {
      completionRafId = null
    }
  }
  completionRafId = requestAnimationFrame(tick)
}

watch(completionPercentage, (next, prev) => {
  animateCompletion(prev ?? 0, next)
})

onBeforeUnmount(() => {
  if (completionRafId !== null) {
    cancelAnimationFrame(completionRafId)
    completionRafId = null
  }
})
</script>

<template>
  <div class="font-poppins min-h-screen bg-white">
    <!-- ============== TOP NAV ============== -->
 
    <!-- ============== BODY ============== -->
    <main class="mx-auto border border-slate-200 max-w-[1200px]">
      <!-- ===== Cover + Profile card ===== -->
      <div class="border-b border-slate-200 bg-white shadow-sm">
        <!-- Cover image container -->
        <div class="relative h-72">
          <!-- Background cover image (clipped to top rounded corners) -->
          <div
            class="absolute inset-0 overflow-hidden bg-cover bg-center"
            :style="{
              backgroundImage: `url('${profileCoverUrl || DEFAULT_COVER}')`,
            }"
          >
            <!-- Bottom fade overlay -->
            <div class="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/70 to-transparent" />
          </div>

          <!-- Nút "Edit Cover" ở góc phải-dưới -->
          <button
            type="button"
            class="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-md bg-black/60 px-3 py-2 text-sm font-medium text-white transition hover:bg-black/80 shadow"
            aria-label="Đổi ảnh bìa"
            :disabled="uploadingCover"
            @click="onPickCover"
          >
            <Camera :size="16" />
            {{ uploadingCover ? 'Đang tải...' : 'Đổi ảnh bìa' }}
          </button>

          <!-- Avatar & Name: Avatar nằm 70% trên cover và 30% nằm dưới phần tabs -->
          <div class="absolute inset-x-0 bottom-0 flex items-end gap-5 px-8 z-20 pointer-events-none">
            <!-- Avatar wrapper: translateY(30%) để 70% nằm trên cover, 30% nằm dưới -->
            <div class="pointer-events-auto" style="transform: translateY(30%);">
              <button
                type="button"
                class="group relative h-36 w-36 shrink-0 cursor-pointer rounded-full border-2 border-white bg-white shadow-lg transition hover:brightness-95"
                aria-label="Đổi ảnh đại diện"
                @click="onPickAvatar"
              >
                <div
                  v-if="profileAvatar"
                  class="h-full w-full rounded-full bg-cover bg-center object-cover"
                  :style="{
                    backgroundImage: `url('${profileAvatar}')`,
                  }"
                />

                <div
                  v-else
                  class="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-pink-300 via-purple-300 to-blue-300 text-3xl font-bold text-white"
                >
                  {{ profileInitial }}
                </div>

                <!-- Hover overlay -->
                <div
                  class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100"
                >
                  <Camera :size="22" class="text-white" />
                </div>

                <!-- Loading state -->
                <div
                  v-if="uploadingAvatar"
                  class="absolute inset-0 flex items-center justify-center rounded-full bg-black/60"
                >
                  <span class="text-xs font-medium text-white">Đang tải...</span>
                </div>
              </button>
            </div>

            <!-- Profile Name nằm trên cover -->
            <div class="pointer-events-auto mb-3">
              <h1 class="text-3xl font-semibold text-white drop-shadow-md">
                {{ profileName }}
              </h1>
            </div>
          </div>
        </div>

        <!-- Profile header: tabs + More button -->
        <div class="relative px-6">
          <!-- Tabs container: spacer bên trái chừa chỗ cho avatar, danh sách tab căn ra gần giữa -->
          <div class="flex items-center justify-between">
            <!-- Left spacer chừa chỗ cho Avatar (w-48 = 192px) -->
            <div class="hidden sm:block w-48 shrink-0" />

            <!-- Danh sách tab căn ra gần giữa -->
            <div class="flex gap-6 md:gap-8 flex-1">
              <button
                v-for="(tab, idx) in profileTabs"
                :key="idx"
                class="relative -mb-px whitespace-nowrap py-3.5 text-sm font-medium transition"
                :class="
                  activeProfileTab === profileTabs[idx]
                    ? 'text-blue-600 font-semibold'
                    : 'text-slate-500 hover:text-slate-700'
                "
                @click="activeProfileTab = profileTabs[idx]"
              >
                <span class="capitalize">{{ profileTabs[idx] }}</span>

                <span
                  v-if="profileTabs[idx] === 'Mạng xã hội' && socialCount !== undefined"
                  class="ml-1 text-xs text-slate-400"
                >
                  {{ socialCount }}
                </span>

                <span
                  v-if="activeProfileTab === tab"
                  class="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-blue-600"
                />
              </button>
            </div>

            <!-- Right: Mức độ hoàn thiện hồ sơ (cân xứng với bên trái w-48) -->
            <div class="shrink-0 sm:w-48">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-xs font-medium text-slate-600">
                  Hoàn thiện hồ sơ
                </span>
                <span
                  class="shrink-0 text-xs font-bold tabular-nums transition-colors duration-700 ease-out"
                  :class="completionColorClass.text"
                >
                  {{ displayedCompletion }}%
                </span>
              </div>
              <div
                class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                :aria-valuenow="completionPercentage"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="`Mức độ hoàn thiện hồ sơ ${completionPercentage}%`"
              >
                <div
                  class="h-full rounded-full transition-[width,background-color] duration-700 ease-out"
                  :class="completionColorClass.bar"
                  :style="{ width: displayedCompletion + '%' }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== Tab content ===== -->
      <!-- Thông tin tab -->
      <section
        v-if="activeProfileTab === 'Thông tin'"
        class="bg-white p-6"
      >
        <h2 class="text-2xl font-bold text-slate-900">
          Thông tin cá nhân
        </h2>

        <hr class="my-4 border-slate-200" />

        <div class="grid grid-cols-1 gap-x-12 gap-y-5 md:grid-cols-2">
          <!-- LEFT column -->
          <div class="space-y-5">
            <div
              v-for="(item, idx) in aboutLeft"
              :key="`l-${idx}`"
              class="flex items-start gap-3"
            >
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <component :is="item.icon" :size="20" />
              </div>

              <div class="min-w-0 flex-1">
                <!-- Title row (label — plain text) -->
                <p class="text-sm text-slate-700">
                  {{ item.title }}
                </p>

                <!-- Subtitle row: edit input hoặc value + pencil inline -->
                <div class="mt-0.5 flex items-center">
                  <!-- Đang edit: input + ✓ + ✕ -->
                  <template v-if="editingItemKey === `left-${idx}`">
                    <input
                      v-model="itemDraft"
                      type="text"
                      class="flex-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-blue-500"
                      @keyup.enter="saveItem('left', idx)"
                      @keyup.escape="cancelEditItem"
                    />
                    <button
                     
                      type="button"
                      class="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                      aria-label="Lưu"
                      @click="saveItem('left', idx)"
                    >
                      <Check :size="14" />
                    </button>
                    <button
                      type="button"
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Hủy"
                      @click="cancelEditItem"
                    >
                      <X :size="14" />
                    </button>
                  </template>

                  <!-- Không edit: pencil chỉ khi có value, + Thêm khi chưa có -->
                  <template v-else>
                    <!-- Đã có value → pencil + value -->
                    <template v-if="item.subtitle">
                      
                      <p class="text-sm font-medium text-slate-900">
                        {{ item.subtitle }}
                      </p>
                      <button
                        type="button"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                        aria-label="Sửa"
                        @click="startEditItem('left', idx, item.subtitle)"
                      >
                        <Pencil :size="12" class="text-slate-400" />
                      </button>
                    </template>
                    <!-- Chưa có → + Thêm (ẩn khi đang trong add mode) -->
                    <button
                      v-if="!item.subtitle && item.actionIcon === 'plus' && addingItemKey !== `left-${idx}`"
                      type="button"
                      class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                      aria-label="Add"
                      @click="startAddItem('left', idx)"
                    >
                      <PlusIcon :size="14" />

                      Thêm
                    </button>
                  </template>
                </div>

                <p
                  v-if="item.extra"
                  class="mt-0.5 text-xs text-slate-500"
                >
                  {{ item.extra }}
                </p>

                <!-- "+ Thêm" — click → input + ✓ inline -->
                <div v-if="addingItemKey === `left-${idx}`" class="mt-2 flex items-center">
                  <input
                    v-model="addDraft"
                    type="text"
                    placeholder="Nhập thông tin..."
                    class="flex-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500"
                    @keyup.enter="saveAddItem('left', idx)"
                    @keyup.escape="cancelAddItem"
                  />
                  <button
                    type="button"
                    class="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    aria-label="Lưu"
                    @click="saveAddItem('left', idx)"
                  >
                    <Check :size="14" />
                  </button>
                  <button
                    type="button"
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Hủy"
                    @click="cancelAddItem"
                  >
                    <X :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- RIGHT column -->
          <div class="space-y-5">
            <div
              v-for="(item, idx) in aboutRight"
              :key="`r-${idx}`"
              class="group flex items-start gap-3"
            >
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <component :is="item.icon" :size="20" />
              </div>

              <div class="min-w-0 flex-1">
                <!-- Title row (label — plain text) -->
                <p class="text-sm text-slate-700">
                  {{ item.title }}
                </p>

                <!-- Subtitle row: pencil TRƯỚC value + pencil inline -->
                <div v-if="item.subtitle" class="mt-0.5 flex items-center gap-1">
                  <p class="text-xs text-slate-500">
                    {{ item.subtitle }}
                  </p>
                  <button
                    v-if="editingItemKey !== `right-${idx}` && idx !== 0"
                    type="button"
                    class="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                    aria-label="Sửa"
                    @click="startEditItem('right', idx, item.subtitle)"
                  >
                    <Pencil :size="12" />
                  </button>
                </div>

                <div v-if="item.links" class="mt-1 space-y-0.5">
                  <a
                    v-for="(link, li) in item.links"
                    :key="li"
                    :href="link.value.startsWith('http') ? link.value : '#'"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block text-xs text-slate-400 hover:text-blue-600"
                  >
                    {{ link.value.replace('https://', '') }}
                  </a>
                </div>

                <!-- Edit input cho Phone (right-1) hoặc Birthday (right-2) — Birthday dùng DD / MM / YYYY -->
                <div v-if="editingItemKey === `right-${idx}`" class="mt-2">
                  <div class="flex items-center gap-2">
                    <input
                      v-if="idx === 2"
                      v-model="birthdayDraft"
                      type="text"
                      inputmode="numeric"
                      placeholder="12 / 06 / 2005"
                      maxlength="14"
                      class="flex-1 rounded-md border bg-white px-2 py-1 text-sm text-slate-700 outline-none placeholder:text-slate-400"
                      :class="birthdayError ? 'border-rose-400 focus:border-rose-500' : 'border-blue-300 focus:border-blue-500'"
                      @input="onBirthdayInput"
                      @keydown="onBirthdayKeydown"
                      @keyup.enter="saveItem('right', idx)"
                      @keyup.escape="cancelEditItem"
                    />
                    <input
                      v-else
                      v-model="itemDraft"
                      type="tel"
                      class="flex-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-blue-500"
                      @keyup.enter="saveItem('right', idx)"
                      @keyup.escape="cancelEditItem"
                    />
                    <button
                      type="button"
                      class="flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors"
                      :class="idx === 2 && (!!birthdayError || (birthdayDraft.trim().length > 0 && birthdayDraft.replace(/\D/g, '').length !== 8)) ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'"
                      
                      aria-label="Lưu"
                      @click="saveItem('right', idx)"
                    >
                      <Check :size="14" />
                    </button>
                    <button
                      type="button"
                      class="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Hủy"
                      @click="cancelEditItem"
                    >
                      <X :size="14" />
                    </button>
                  </div>
                  <!-- Helper / Error message cho Ngày sinh -->
                  <template v-if="idx === 2">
                    <p v-if="birthdayError" class="mt-1 text-xs font-medium text-rose-500">
                      {{ birthdayError }}
                    </p>
                    <p v-else class="mt-1 text-xs text-slate-400">
                      Định dạng: Ngày / Tháng / Năm (ví dụ: 12 / 06 / 2005)
                    </p>
                  </template>
                </div>

                <div class="mt-2 flex items-center">
                  <!-- Add mode: input + ✓ + ✕ -->
                  <div v-if="addingItemKey === `right-${idx}`" class="flex flex-1 items-center">
                    <input
                      v-model="addDraft"
                      type="text"
                      placeholder="Nhập thông tin..."
                      class="flex-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500"
                      @keyup.enter="saveAddItem('right', idx)"
                      @keyup.escape="cancelAddItem"
                    />
                    <button
                      type="button"
                      class="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                      aria-label="Lưu"
                      @click="saveAddItem('right', idx)"
                    >
                      <Check :size="14" />
                    </button>
                    <button
                      type="button"
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Hủy"
                      @click="cancelAddItem"
                    >
                      <X :size="14" />
                    </button>
                  </div>

                  <button
                    v-else-if="item.actionIcon === 'plus' && editingItemKey !== `right-${idx}`"
                    type="button"
                    class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                    aria-label="Add"
                    @click="startAddItem('right', idx)"
                  >
                    <PlusIcon :size="14" />

                    Thêm
                  </button>

                  <!-- (pencil cũ đã chuyển lên subtitle row — bỏ duplicate ở đây) -->
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Địa chỉ tab (tương tự pattern tab Thông tin & Mạng xã hội) -->
      <section
        v-else-if="activeProfileTab === 'Địa chỉ'"
        class="bg-white p-6"
      >
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-slate-900">
              Địa chỉ
            </h2>
            <p class="mt-1 text-sm text-slate-500">
              Nơi bạn đang sinh sống và làm việc.
            </p>
          </div>

          <button
            v-if="!isEditingAddress"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200"
            @click="startEditAddress"
          >
            <Pencil :size="13" />
            <span>Chỉnh sửa</span>
          </button>
        </div>

        <hr class="my-4 border-slate-200" />

        <div class="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2">
          <!-- LEFT column: Chế độ Xem (View) hoặc Chế độ Sửa (Edit) -->
          <div>
            <!-- VIEW MODE: Hiển thị các trường đồng bộ pattern tab Thông tin -->
            <div v-if="!isEditingAddress" class="space-y-5">
              <!-- 1. Tỉnh / Thành phố -->
              <div class="group flex items-start gap-3">
                <div
                  class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                >
                  <Building2 :size="20" />
                </div>

                <div class="min-w-0 flex-1">
                  <p class="text-sm text-slate-700">
                    Tỉnh / Thành phố
                  </p>
                  <div class="mt-0.5 flex items-center gap-1.5">
                    <template v-if="savedProvinceCode && provinceName(savedProvinceCode)">
                      <p class="text-sm font-medium text-slate-900">
                        {{ provinceName(savedProvinceCode) }}
                      </p>
                      <button
                        type="button"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                        aria-label="Sửa Tỉnh/Thành phố"
                        @click="startEditAddress"
                      >
                        <Pencil :size="12" />
                      </button>
                    </template>
                    <button
                      v-else
                      type="button"
                      class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                      aria-label="Thêm Tỉnh/Thành phố"
                      @click="startEditAddress"
                    >
                      <PlusIcon :size="14" />
                      Thêm
                    </button>
                  </div>
                </div>
              </div>

              <!-- 2. Quận / Huyện -->
              <div class="group flex items-start gap-3">
                <div
                  class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                >
                  <Navigation :size="20" />
                </div>

                <div class="min-w-0 flex-1">
                  <p class="text-sm text-slate-700">
                    Quận / Huyện
                  </p>
                  <div class="mt-0.5 flex items-center gap-1.5">
                    <template v-if="savedDistrictCode && districtName(savedProvinceCode, savedDistrictCode)">
                      <p class="text-sm font-medium text-slate-900">
                        {{ districtName(savedProvinceCode, savedDistrictCode) }}
                      </p>
                      <button
                        type="button"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                        aria-label="Sửa Quận/Huyện"
                        @click="startEditAddress"
                      >
                        <Pencil :size="12" />
                      </button>
                    </template>
                    <button
                      v-else
                      type="button"
                      class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                      aria-label="Thêm Quận/Huyện"
                      @click="startEditAddress"
                    >
                      <PlusIcon :size="14" />
                      Thêm
                    </button>
                  </div>
                </div>
              </div>

              <!-- 3. Địa chỉ chi tiết (số nhà, đường) -->
              <div class="group flex items-start gap-3">
                <div
                  class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                >
                  <Home :size="20" />
                </div>

                <div class="min-w-0 flex-1">
                  <p class="text-sm text-slate-700">
                    Địa chỉ chi tiết (số nhà, đường)
                  </p>
                  <div class="mt-0.5 flex items-center gap-1.5">
                    <template v-if="savedStreet">
                      <p class="text-sm font-medium text-slate-900 truncate max-w-[280px]">
                        {{ savedStreet }}
                      </p>
                      <button
                        type="button"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                        aria-label="Sửa địa chỉ chi tiết"
                        @click="startEditAddress"
                      >
                        <Pencil :size="12" />
                      </button>
                    </template>
                    <button
                      v-else
                      type="button"
                      class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                      aria-label="Thêm địa chỉ chi tiết"
                      @click="startEditAddress"
                    >
                      <PlusIcon :size="14" />
                      Thêm
                    </button>
                  </div>
                </div>
              </div>

              <!-- 4. Địa chỉ hoàn chỉnh & Trạng thái định vị -->
              <div class="flex items-start gap-3">
                <div
                  class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                >
                  <MapPinned :size="20" />
                </div>

                <div class="min-w-0 flex-1">
                  <p class="text-sm text-slate-700">
                    Địa chỉ hoàn chỉnh
                  </p>
                  <p v-if="fullAddressString" class="mt-0.5 text-xs text-slate-600 leading-relaxed font-medium">
                    {{ fullAddressString }}
                  </p>
                  <p v-else class="mt-0.5 text-xs text-slate-400">
                    Chưa thiết lập địa chỉ
                  </p>

                  <div class="mt-1 flex items-center gap-1.5 text-[11px]">
                    <template v-if="pickedLat !== null && pickedLng !== null">
                      <span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      <span class="text-emerald-700 font-medium">
                        Đã định vị tọa độ ({{ pickedLat.toFixed(4) }}, {{ pickedLng.toFixed(4) }})
                      </span>
                    </template>
                    <template v-else>
                      <span class="inline-block h-2 w-2 rounded-full bg-amber-500" />
                      <span class="text-amber-700 font-medium">
                        Chưa xác định tọa độ bản đồ
                      </span>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- EDIT MODE: Gọi API ngoài cho Tỉnh/Quận + Ô nhập địa chỉ chi tiết có nút Kiểm tra & Lấy tọa độ -->
            <div v-else class="space-y-4 rounded-xl border border-blue-200 bg-blue-50/30 p-5 shadow-sm">
              <div class="flex items-center justify-between pb-2 border-b border-blue-100">
                <div class="flex items-center gap-2">
                  <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                    <Pencil :size="15" />
                  </div>
                  <div>
                    <h3 class="text-sm font-semibold text-slate-900">Chỉnh sửa địa chỉ</h3>
                    <p class="text-xs text-slate-500">Tải danh sách tỉnh/huyện từ API và định vị tọa độ</p>
                  </div>
                </div>

                <button
                  type="button"
                  class="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 transition"
                  aria-label="Đóng"
                  @click="cancelEditAddress"
                >
                  <X :size="16" />
                </button>
              </div>

              <!-- 1. Tỉnh / Thành phố (API call ngoài) -->
              <div>
                <label class="mb-1 block text-xs font-medium text-slate-700">
                  Tỉnh / Thành phố
                  <span v-if="locationsLoading" class="ml-1 text-[11px] font-normal text-blue-600 animate-pulse">(Đang gọi API tải danh sách...)</span>
                </label>
                <select
                  v-model.number="draftProvinceCode"
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  :disabled="locationsLoading && provinces.length === 0"
                  @change="onProvinceChange"
                >
                  <option :value="null">-- Chọn tỉnh/thành --</option>
                  <option v-for="p in provinces" :key="p.code" :value="p.code">
                    {{ p.name }}
                  </option>
                </select>
              </div>

              <!-- 2. Quận / Huyện (API call ngoài theo tỉnh) -->
              <div>
                <label class="mb-1 block text-xs font-medium text-slate-700">
                  Quận / Huyện
                  <span v-if="!draftProvinceCode" class="ml-1 text-[11px] font-normal text-slate-400">(Vui lòng chọn Tỉnh/Thành trước)</span>
                </label>
                <select
                  v-model.number="draftDistrictCode"
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                  :disabled="!draftProvinceCode"
                >
                  <option :value="null">-- Chọn quận/huyện --</option>
                  <option v-for="d in availableDistricts" :key="d.code" :value="d.code">
                    {{ d.name }}
                  </option>
                </select>
              </div>

              <!-- 3. Địa chỉ chi tiết (số nhà, đường) + Nút Kiểm tra và Lấy tọa độ -->
              <div>
                <label class="mb-1 block text-xs font-medium text-slate-700">
                  Địa chỉ chi tiết (số nhà, đường, phường)
                </label>
                <div class="flex gap-2">
                  <input
                    v-model="draftStreet"
                    type="text"
                    placeholder="Vd: 12 Nguyễn Huệ, Phường Bến Nghé"
                    class="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    @keyup.enter="previewAddressOnMap"
                  />

                  <button
                    type="button"
                    class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3.5 py-2 text-xs font-medium text-blue-700 shadow-sm transition hover:bg-blue-50 hover:border-blue-400 disabled:opacity-50"
                    :disabled="geocodingLoading || !draftProvinceCode"
                    title="Kiểm tra địa chỉ và lấy tọa độ ghim bản đồ"
                    @click="previewAddressOnMap"
                  >
                    <Loader2 v-if="geocodingLoading" :size="14" class="animate-spin text-blue-600" />
                    <MapPin v-else :size="14" class="text-blue-600" />
                    <span>{{ geocodingLoading ? 'Đang tìm...' : 'Kiểm tra' }}</span>
                  </button>
                </div>
                <p class="mt-1 text-[11px] text-slate-500">
                  Bấm <strong>"Kiểm tra"</strong> để tìm và ghim tọa độ chính xác lên bản đồ bên phải trước khi lưu.
                </p>
              </div>

              <!-- Actions: Hủy + Lưu địa chỉ -->
              <div class="flex items-center justify-end gap-2 pt-2 border-t border-blue-100">
                <button
                  type="button"
                  class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                  @click="cancelEditAddress"
                >
                  Hủy
                </button>

                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition shadow-sm disabled:opacity-50"
                  :disabled="savingAddress"
                  @click="saveAddress"
                >
                  <Loader2 v-if="savingAddress" :size="14" class="animate-spin" />
                  <Check v-else :size="14" />
                  <span>{{ savingAddress ? 'Đang lưu...' : 'Lưu địa chỉ' }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- RIGHT column: Bản đồ xem trước OpenStreetMap -->
          <div class="space-y-2">
            <div class="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <div class="mb-3 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                    <MapPin :size="16" />
                  </div>
                  <div>
                    <h4 class="text-sm font-semibold text-slate-900">Bản đồ vị trí</h4>
                    <p class="text-[11px] text-slate-500">Xem trước vị trí trên OpenStreetMap</p>
                  </div>
                </div>

                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-blue-600 disabled:opacity-50"
                  :disabled="geocodingLoading"
                  title="Tìm lại tọa độ theo địa chỉ hiện tại"
                  @click="refreshMapLocation"
                >
                  <RotateCw :size="13" :class="{ 'animate-spin': geocodingLoading }" />
                  <span>{{ geocodingLoading ? 'Đang tìm...' : 'Định vị lại' }}</span>
                </button>
              </div>

              <!-- Map iframe -->
              <div class="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-inner">
                <!-- Location badge overlay on map -->
                <div
                  v-if="fullAddressString"
                  class="pointer-events-none absolute left-2 top-2 z-10 max-w-[85%] truncate rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-800 shadow backdrop-blur-sm"
                >
                  📍 {{ fullAddressString }}
                </div>

                <iframe
                  :src="previewBbox
                    ? `https://www.openstreetmap.org/export/embed.html?bbox=${previewBbox}&layer=mapnik&marker=${previewMarker}`
                    : 'https://www.openstreetmap.org/export/embed.html?bbox=106.65,10.73,106.78,10.82&layer=mapnik&marker=10.775,10.775'"
                  class="h-64 w-full"
                  style="border: 0"
                  loading="lazy"
                  referrerpolicy="no-referrer-when-downgrade"
                  title="OpenStreetMap preview"
                />

                <!-- Overlay che watermark OSM ở góc dưới-phải -->
                <div
                  class="pointer-events-none absolute bottom-0 right-0 h-6 w-24 bg-white"
                  aria-hidden="true"
                />
              </div>

              <!-- Bottom info bar -->
              <div class="mt-2.5 flex items-center justify-between text-[11px] text-slate-500">
                <span v-if="pickedLat !== null && pickedLng !== null">
                  Tọa độ: <span class="font-mono text-slate-700">{{ pickedLat.toFixed(5) }}, {{ pickedLng.toFixed(5) }}</span>
                </span>
                <span v-else class="text-amber-600">
                  Chưa xác định tọa độ chính xác
                </span>

                <span class="text-slate-400">© OpenStreetMap</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <!-- Mạng xã hội tab (tương tự pattern tab Thông tin) -->
      <section
        v-else-if="activeProfileTab === 'Mạng xã hội'"
        class="bg-white p-6"
      >
        <div>
          <h2 class="text-2xl font-bold text-slate-900">
            Mạng xã hội
          </h2>
          <p class="mt-1 text-sm text-slate-500">
            Liên kết mạng xã hội và tài khoản trực tuyến của bạn.
          </p>
        </div>

        <hr class="my-4 border-slate-200" />

        <div class="grid grid-cols-1 gap-x-12 gap-y-5 md:grid-cols-2">
          <!-- LEFT column -->
          <div class="space-y-5">
            <div
              v-for="item in socialLeft"
              :key="item.key"
              class="group flex items-start gap-3"
            >
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <component :is="item.icon" :size="20" />
              </div>

              <div class="min-w-0 flex-1">
                <!-- Title row (label — plain text) -->
                <div class="flex items-center justify-between">
                  <p class="text-sm text-slate-700">
                    {{ item.label }}
                  </p>
                  <button
                    v-if="item.isCustom"
                    type="button"
                    class="flex h-5 w-5 items-center justify-center rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 transition"
                    title="Xóa mạng xã hội này"
                    @click="deleteSocial(item.key, item.label)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>

                <!-- Subtitle row: edit input hoặc value + pencil inline -->
                <div class="mt-0.5 flex items-center">
                  <!-- Đang edit: input + ✓ + ✕ -->
                  <template v-if="editingSocialKey === item.key">
                    <input
                      v-model="socialDraft"
                      type="text"
                      :placeholder="item.placeholder"
                      class="flex-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500"
                      @keyup.enter="saveSingleSocial(item.key)"
                      @keyup.escape="cancelEditSingleSocial"
                    />
                    <button
                      type="button"
                      class="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                      aria-label="Lưu"
                      @click="saveSingleSocial(item.key)"
                    >
                      <Check :size="14" />
                    </button>
                    <button
                      type="button"
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Hủy"
                      @click="cancelEditSingleSocial"
                    >
                      <X :size="14" />
                    </button>
                  </template>

                  <!-- Không edit: link/value + pencil inline, hoặc + Thêm -->
                  <template v-else>
                    <!-- Đã có value → link + pencil -->
                    <template v-if="item.value">
                      <a
                        :href="item.value"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline truncate max-w-[260px]"
                      >
                        <span class="truncate">{{ shortUrl(item.value) }}</span>
                        <ExternalLink :size="12" class="shrink-0 text-slate-400" />
                      </a>
                      <button
                        type="button"
                        class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                        aria-label="Sửa"
                        @click="startEditSingleSocial(item.key, item.value)"
                      >
                        <Pencil :size="12" />
                      </button>
                    </template>

                    <!-- Chưa có → + Thêm -->
                    <button
                      v-else
                      type="button"
                      class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                      aria-label="Thêm"
                      @click="startEditSingleSocial(item.key, '')"
                    >
                      <PlusIcon :size="14" />
                      Thêm
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- RIGHT column -->
          <div class="space-y-5">
            <div
              v-for="item in socialRight"
              :key="item.key"
              class="group flex items-start gap-3"
            >
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <component :is="item.icon" :size="20" />
              </div>

              <div class="min-w-0 flex-1">
                <!-- Title row (label — plain text) -->
                <div class="flex items-center justify-between">
                  <p class="text-sm text-slate-700">
                    {{ item.label }}
                  </p>
                  <button
                    v-if="item.isCustom"
                    type="button"
                    class="flex h-5 w-5 items-center justify-center rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 transition"
                    title="Xóa mạng xã hội này"
                    @click="deleteSocial(item.key, item.label)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>

                <!-- Subtitle row: edit input hoặc value + pencil inline -->
                <div class="mt-0.5 flex items-center">
                  <!-- Đang edit: input + ✓ + ✕ -->
                  <template v-if="editingSocialKey === item.key">
                    <input
                      v-model="socialDraft"
                      type="text"
                      :placeholder="item.placeholder"
                      class="flex-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500"
                      @keyup.enter="saveSingleSocial(item.key)"
                      @keyup.escape="cancelEditSingleSocial"
                    />
                    <button
                      type="button"
                      class="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                      aria-label="Lưu"
                      @click="saveSingleSocial(item.key)"
                    >
                      <Check :size="14" />
                    </button>
                    <button
                      type="button"
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Hủy"
                      @click="cancelEditSingleSocial"
                    >
                      <X :size="14" />
                    </button>
                  </template>

                  <!-- Không edit: link/value + pencil inline, hoặc + Thêm -->
                  <template v-else>
                    <!-- Đã có value → link + pencil -->
                    <template v-if="item.value">
                      <a
                        :href="item.value"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline truncate max-w-[260px]"
                      >
                        <span class="truncate">{{ shortUrl(item.value) }}</span>
                        <ExternalLink :size="12" class="shrink-0 text-slate-400" />
                      </a>
                      <button
                        type="button"
                        class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                        aria-label="Sửa"
                        @click="startEditSingleSocial(item.key, item.value)"
                      >
                        <Pencil :size="12" />
                      </button>
                    </template>

                    <!-- Chưa có → + Thêm -->
                    <button
                      v-else
                      type="button"
                      class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                      aria-label="Thêm"
                      @click="startEditSingleSocial(item.key, '')"
                    >
                      <PlusIcon :size="14" />
                      Thêm
                    </button>
                  </template>
                </div>
              </div>
            </div>

            <!-- 4. Mục Thêm mạng xã hội khác (nằm ở dưới Portfolio / Website) -->
            <div class="flex items-start gap-3">
              <div
                class="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition"
                @click="!isAddingSocial && startAddSocial()"
              >
                <PlusIcon :size="20" />
              </div>

              <div class="min-w-0 flex-1">
                <!-- Chế độ bình thường -->
                <template v-if="!isAddingSocial">
                  <div class="flex items-center justify-between">
                    <p class="text-sm text-slate-700">
                      Mạng xã hội khác
                    </p>
                  </div>

                  <div class="mt-0.5 flex items-center">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
                      aria-label="Thêm mạng xã hội khác"
                      @click="startAddSocial"
                    >
                      <PlusIcon :size="14" />
                      Thêm
                    </button>
                  </div>
                </template>

                <!-- Chế độ edit/thêm: 2 ô như pattern edit ở trên (tên mạng xã hội ở trên, ở dưới là links) -->
                <template v-else>
                  <div class="space-y-1.5">
                    <!-- Ô trên: Tên mạng xã hội -->
                    <input
                      ref="socialNameInputRef"
                      v-model="newSocialName"
                      type="text"
                      placeholder="Tên mạng xã hội"
                      class="w-full rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500"
                      @keyup.enter="onSocialNameEnter"
                      @keyup.escape="cancelAddSocial"
                    />

                    <!-- Ô dưới: links + ✓ + ✕ -->
                    <div class="flex items-center">
                      <input
                        ref="socialUrlInputRef"
                        v-model="newSocialUrl"
                        type="text"
                        placeholder="links"
                        class="flex-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500"
                        @keyup.enter="saveNewSocial"
                        @keyup.escape="cancelAddSocial"
                      />
                      <button
                        type="button"
                        class="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        aria-label="Lưu"
                        :disabled="addingSocialLoading"
                        @click="saveNewSocial"
                      >
                        <Loader2 v-if="addingSocialLoading" :size="14" class="animate-spin" />
                        <Check v-else :size="14" />
                      </button>
                      <button
                        type="button"
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Hủy"
                        @click="cancelAddSocial"
                      >
                        <X :size="14" />
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </section>
      <!-- Hồ sơ nghề nghiệp tab -->
      <section
        v-else-if="activeProfileTab === 'Hồ sơ nghề nghiệp'"
        class="bg-white p-6"
      >
        <h2 class="text-2xl font-bold text-slate-900">
          Hồ sơ nghề nghiệp
        </h2>

        <p class="mt-1 text-sm text-slate-500">
          Thông tin kinh nghiệm làm việc và học vấn của bạn.
        </p>

        <hr class="my-4 border-slate-200" />

        <p class="text-sm text-slate-500">
          Tính năng đang phát triển. Vui lòng quay lại sau.
        </p>
      </section>
    </main>

    <!-- Hidden inputs cho upload — click vào avatar/cover mới trigger -->
    <input
      ref="avatarInputEl"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      class="hidden"
      @change="onAvatarFileChange"
    />
    <input
      ref="coverInputEl"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      class="hidden"
      @change="onCoverFileChange"
    />
  </div>
</template>
