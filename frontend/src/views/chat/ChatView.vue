<script setup lang="ts">
/**
 * MockupChat — 3-column chat UI dùng real chat API (1-1).
 *
 * Wiring map:
 *   - Sidebar "Tin nhắn"        ← store.conversations
 *   - Chat header + right panel  ← store.activeConversation?.peer
 *   - Message list               ← useChat().messages (realtime + REST)
 *   - Composer                   ← chatHook.send() + uploadApi.uploadChatAttachment()
 *   - Right panel Images/Files   ← chatApi.listAttachments(activeId)
 *
 * Static (no API):
 *   - Sidebar tabs / "Đoạn chat mới" / Groups
 *   - Right panel: "Group Information" title, Links section
 */
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import {
  Phone,
  Video,
  MoreHorizontal,
  Moon,
  Smile,
  Paperclip,
  Send,
  Settings2,
  Loader2,
  Check,
  ChevronRight,
  X,
  Download,
} from 'lucide-vue-next'
import { useChatStore } from '@stores/chat'
import { useAuthStore } from '@stores/auth'
import { useChat } from '@composables/useChat'
import { uploadApi, formatFileSize } from '@services/upload.api'
import { fileIconInfo } from '@utils/fileIcon'
import { useToastStore } from '@stores/toast'
import ChatSidebar from '@components/chat/ChatSidebar.vue'
import ChatInfoPanel from '@components/chat/ChatInfoPanel.vue'
import type {
  ChatAttachmentDraft,
  ChatMessage,
  PeerRole,
} from '@/types/chat'

const store = useChatStore()
const auth = useAuthStore()
const toast = useToastStore()

// (demo message removed — backend không có voice/reactions)

// ===== Chat wiring =====
const activeId = ref<string | null>(null)
const chatHook = useChat(() => activeId.value ?? '')
const showInfoPanel = ref(false)

function toggleInfoPanel() {
  showInfoPanel.value = !showInfoPanel.value
}

// ===== Sidebar =====
const selectConversation = async (id: string): Promise<void> => {
  if (activeId.value === id) return
  activeId.value = id
  await store.setActive(id)
}

// ===== Chat header =====
const roleLabel = (role: PeerRole): string => {
  if (role === 'employer') return 'Nhà tuyển dụng'
  if (role === 'admin') return 'Quản trị viên'
  return 'Ứng viên'
}

// ===== Messages middle =====
const groupedMessages = computed(() => {
  const groups: { date: string; label: string; items: ChatMessage[] }[] = []
  let currentKey = ''
  for (const m of chatHook?.messages.value ?? []) {
    const d = new Date(m.createdAt)
    const key = d.toDateString()
    const sameDay = key === new Date().toDateString()
    const label = sameDay
      ? 'Today'
      : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    if (key !== currentKey) {
      groups.push({ date: key, label, items: [m] })
      currentKey = key
    } else {
      groups[groups.length - 1].items.push(m)
    }
  }
  return groups
})

const fmtTime = (iso: string): string => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const isOwn = (m: ChatMessage): boolean => m.senderId === (auth.user?.id ?? '')

const lastOwnReadId = computed<string | null>(() => {
  const me = auth.user?.id
  if (!me) return null
  const real = chatHook?.messages.value ?? []
  for (let i = real.length - 1; i >= 0; i--) {
    const m = real[i]
    if (m.senderId === me && m.readAt) return m.id
  }
  return null
})

/** ID của message cuối cùng trong conv (để luôn hiển thị status). */
const lastMessageId = computed<string | null>(() => {
  const real = chatHook?.messages.value ?? []
  return real.length > 0 ? real[real.length - 1].id : null
})

const safe = (s: string): string => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\n/g, '<br>')

/** ID message đang được expand (click để hiện timestamp + read receipt). */
const expandedMessageId = ref<string | null>(null)
const toggleExpand = (id: string): void => {
  expandedMessageId.value = expandedMessageId.value === id ? null : id
}

// ===== Composer =====
const messageInput = ref('')
const textareaEl = ref<HTMLInputElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)

interface PendingAttachment {
  id: string
  status: 'uploading' | 'done' | 'error'
  kind: 'image' | 'file'
  url?: string
  key?: string
  mime?: string
  sizeBytes?: number
  error?: string
  previewUrl: string | null
  name: string
}
const attachments = ref<PendingAttachment[]>([])

const canSend = computed(() => {
  const hasText = messageInput.value.trim().length > 0
  const hasUploadedAttachment = attachments.value.some((a) => a.status === 'done')
  return hasText || hasUploadedAttachment
})

const uploadingCount = computed(
  () => attachments.value.filter((a) => a.status === 'uploading').length,
)

const fileIcon = (mime: string, name?: string | null) => fileIconInfo(mime, name)

const uploadFile = async (file: File): Promise<void> => {
  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const isImage = file.type.startsWith('image/')
  const previewUrl = isImage ? URL.createObjectURL(file) : null
  attachments.value = [
    ...attachments.value,
    { id, status: 'uploading', kind: isImage ? 'image' : 'file', previewUrl, name: file.name },
  ]

  try {
    const result = await uploadApi.uploadChatAttachment(file)
    attachments.value = attachments.value.map((a) =>
      a.id === id
        ? {
            ...a,
            status: 'done',
            url: result.url,
            key: result.key,
            mime: result.mime,
            sizeBytes: result.size,
            kind: result.kind,
          }
        : a,
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Upload thất bại'
    attachments.value = attachments.value.map((a) =>
      a.id === id ? { ...a, status: 'error', error: msg } : a,
    )
    toast.push({ variant: 'error', title: 'Upload thất bại', body: msg })
  }
}

const removeAttachment = (id: string): void => {
  const target = attachments.value.find((a) => a.id === id)
  if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
  attachments.value = attachments.value.filter((a) => a.id !== id)
}

const onPickFile = (): void => fileInputEl.value?.click()

const onFileInputChange = (e: Event): void => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  void Promise.all(Array.from(files).map((f) => uploadFile(f)))
  target.value = ''
}

const onPaste = (e: ClipboardEvent): void => {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length === 0) return
  e.preventDefault()
  void Promise.all(files.map((f) => uploadFile(f)))
}

const sendMessage = (): void => {
  if (!canSend.value || !activeId.value) return
  const content = messageInput.value.trim()
  const readyAttachments: ChatAttachmentDraft[] = attachments.value
    .filter(
      (a) =>
        a.status === 'done' && a.url && a.key && a.mime && a.sizeBytes !== undefined,
    )
    .map((a) => ({
      url: a.url!,
      key: a.key!,
      mime: a.mime!,
      sizeBytes: a.sizeBytes!,
      kind: a.kind,
      name: a.name,
    }))
  chatHook?.send(content, readyAttachments)
  messageInput.value = ''
  for (const a of attachments.value) {
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
  }
  attachments.value = []
  chatHook?.typing(false)
  void nextTick(() => textareaEl.value?.focus())
}

const onComposerKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

const onComposerInput = (): void => {
  chatHook?.typing(messageInput.value.length > 0)
}

const filenameFromUrl = (url: string): string => {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() ?? ''
    const noExt = last.replace(/\.[^.]+$/, '')
    return noExt.replace(/^[0-9a-f-]{36}-/, '') || last
  } catch {
    return url
  }
}

// ===== Auto-scroll to bottom on new messages =====
const messagesEl = ref<HTMLElement | null>(null)
const lastMessageCount = ref(0)

watch(
  () => chatHook?.messages.value.length ?? 0,
  async (count) => {
    if (count === 0 || count <= lastMessageCount.value) {
      lastMessageCount.value = count
      return
    }
    lastMessageCount.value = count
    await nextTick()
    if (messagesEl.value) {
      messagesEl.value.scrollTo({
        top: messagesEl.value.scrollHeight,
        behavior: 'smooth',
      })
    }
  },
)

// Reset counter khi đổi conversation để scroll xuống cuối cho conv mới
watch(activeId, () => {
  lastMessageCount.value = 0
})

// ===== Initial mount =====
onMounted(async () => {
  await store.fetchConversations(true)
  if (!activeId.value && store.conversations.length > 0) {
    const first = store.conversations[0]
    activeId.value = first.id
    await store.setActive(first.id)
  }
})
</script>

<template>
  <div class="font-poppins h-screen bg-[#f5f6f8]">
    <div
      class="font-poppins mx-auto flex h-full max-w-[1600px] overflow-hidden bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
    >
      <!-- ================= LEFT SIDEBAR ================= -->
      <ChatSidebar
        :active-id="activeId"
        @select="selectConversation"
      />

      <!-- ================= MIDDLE CHAT ================= -->
      <main class="flex min-w-0 flex-1 flex-col border-r border-slate-200">
        <!-- Header — WIRED -->
        <header
          class="flex h-[82px] shrink-0 items-center justify-between border-b border-slate-200 px-5 md:px-6"
        >
          <div class="flex items-center gap-3">
            <div class="relative">
              <img
                v-if="store.activeConversation?.peer.avatarUrl"
                :src="store.activeConversation.peer.avatarUrl"
                class="h-11 w-11 rounded-full object-cover"
              />

              <img
                v-else
                src="/avatars/peer-default.svg"
                alt=""
                class="h-11 w-11 rounded-full object-cover"
              />

              <span
                class="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500"
              />
            </div>

            <div>
              <h1 class="text-base font-semibold text-slate-900">
                {{
                  store.activeConversation?.peer.fullName ?? 'Chọn cuộc hội thoại'
                }}
              </h1>

              <p class="mt-0.5 text-xs text-slate-400">
                {{
                  store.activeConversation?.peer
                    ? roleLabel(store.activeConversation.peer.role)
                    : '—'
                }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <button
              @click="toggleInfoPanel"
              class="flex h-10 w-10 items-center justify-center rounded-xl transition"
              :class="
                showInfoPanel
                  ? 'bg-blue-50 text-blue-500'
                  : 'text-slate-500 hover:bg-slate-100'
              "
              title="Toggle group info"
            >
              <Settings2 :size="18" />
            </button>
          </div>
        </header>

        <!-- Messages — WIRED -->
        <section
          ref="messagesEl"
          class="messages-scroll flex-1 overflow-y-auto bg-white px-5 py-6 md:px-8"
        >
          <div v-if="!activeId" class="flex h-full items-center justify-center">
            <p class="text-sm text-slate-400">
              Chọn một cuộc hội thoại để bắt đầu
            </p>
          </div>

          <template v-else>
            <div
              v-if="store.loadingMessages && (chatHook?.messages.value.length ?? 0) === 0"
              class="flex justify-center py-12"
            >
              <Loader2 class="h-6 w-6 animate-spin text-slate-400" />
            </div>

            <div v-else class="mx-auto max-w-[760px] space-y-5">
              <template v-for="group in groupedMessages" :key="group.date">
                <!-- Date divider -->
                <div class="flex items-center gap-4 py-2">
                  <div class="h-px flex-1 bg-slate-200" />

                  <span class="text-[10px] font-medium text-slate-400">
                    {{ group.label }}
                  </span>

                  <div class="h-px flex-1 bg-slate-200" />
                </div>

                <template v-for="m in group.items" :key="m.id">
                  <!-- Real chat message -->
                  <div
                    class="group flex cursor-pointer"
                    :class="isOwn(m) ? 'justify-end' : 'justify-start'"
                    @click="toggleExpand(m.id)"
                  >
                    <div
                      v-if="!isOwn(m)"
                      class="mr-2 shrink-0 self-end"
                    >
                      <img
                        v-if="store.activeConversation?.peer.avatarUrl"
                        :src="store.activeConversation.peer.avatarUrl"
                        class="h-8 w-8 rounded-full object-cover"
                      />

                      <img
                        v-else
                        src="/avatars/peer-default.svg"
                        alt=""
                        class="h-8 w-8 rounded-full object-cover"
                      />
                    </div>

                    <div
                      class="max-w-[70%] text-sm leading-relaxed"
                      :class="(() => {
                        const hasAtt = !!(m.attachments && m.attachments.length > 0)
                        const hasText = !!m.content?.trim()
                        const own = isOwn(m)
                        // Outgoing attachment-only (no text) → no bubble, let card stand out
                        if (own && hasAtt && !hasText) {
                          return 'rounded-2xl rounded-br-none bg-transparent text-slate-700'
                        }
                        return own
                          ? 'rounded-2xl rounded-br-none bg-blue-700 px-3.5 py-2 text-white shadow-sm'
                          : 'rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2 text-slate-700 shadow-sm'
                      })()"
                    >
                      <!-- Attachments -->
                      <div
                        v-if="m.attachments && m.attachments.length > 0"
                        class="mb-1.5 space-y-1"
                      >
                        <div
                          v-for="(att, idx) in m.attachments"
                          :key="`${m.id}-att-${idx}`"
                        >
                          <a
                            v-if="(att.kind ?? 'image') === 'image' || att.mime.startsWith('image/')"
                            :href="att.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="block overflow-hidden rounded-md bg-slate-100"
                          >
                            <img
                              :src="att.url"
                              :alt="att.name ?? att.mime"
                              class="max-h-[200px] max-w-[200px] object-cover"
                              loading="lazy"
                            />
                          </a>

                          <a
                            v-else
                            :href="att.url"
                            :download="att.name ?? true"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-800 transition hover:bg-slate-100"
                          >
                            <component
                              :is="fileIcon(att.mime, att.name).icon"
                              class="h-4 w-4 shrink-0"
                              :class="fileIcon(att.mime, att.name).color"
                            />

                            <span class="min-w-0 flex-1 truncate text-xs font-medium">
                              {{ att.name ?? filenameFromUrl(att.url) }}
                            </span>

                            <span
                              class="shrink-0 text-[10px] text-slate-500"
                            >
                              {{ formatFileSize(att.sizeBytes) }}
                            </span>

                            <Download class="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          </a>
                        </div>
                      </div>

                      <div
                        v-if="m.content"
 class="break-words whitespace-pre-wrap"
                        v-html="safe(m.content)"
                      />

                      <div
                        v-if="
                          (expandedMessageId === m.id || lastMessageId === m.id) &&
                          (m.content || (m.attachments && m.attachments.length > 0))
                        "
                        class="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400"
                      >
                        <span>{{ fmtTime(m.createdAt) }}</span>

                        <Check
                          v-if="isOwn(m) && !m.readAt"
                          class="inline-block h-3.5 w-3.5"
                          aria-label="Đã gửi"
                        />

                        <img
                          v-else-if="isOwn(m) && m.readAt && m.id === lastOwnReadId && store.activeConversation?.peer.avatarUrl"
                          :src="store.activeConversation.peer.avatarUrl"
                          :alt="`Đã xem lúc ${fmtTime(m.readAt)}`"
                          class="ml-1 h-4 w-4 rounded-full object-cover ring-1 ring-white"
                        />
                      </div>
                    </div>
                  </div>
                </template>
              </template>

              <!-- Typing indicator -->
              <div v-if="chatHook?.peerTyping.value" class="flex justify-start">
                <div class="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2">
                  <div class="flex gap-1">
                    <span
                      class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                      style="animation-delay: 0ms"
                    />

                    <span
                      class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                      style="animation-delay: 150ms"
                    />

                    <span
                      class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                      style="animation-delay: 300ms"
                    />
                  </div>
                </div>
              </div>
            </div>
          </template>
        </section>

        <!-- Composer — WIRED -->
        <footer class="border-t border-slate-200 bg-white p-4">
          <!-- Attachment preview row -->
          <div
            v-if="attachments.length > 0"
            class="mx-auto mb-2 flex max-w-[760px] flex-wrap gap-2 border-b border-slate-100 pb-2"
          >
            <div
              v-for="att in attachments"
              :key="att.id"
              class="group relative overflow-hidden rounded-md border bg-slate-50"
              :class="[
                att.kind === 'image' ? 'h-16 w-16' : 'h-16 min-w-[180px] max-w-[220px] px-2.5 py-1.5',
                att.status === 'error' ? 'border-red-300' : 'border-slate-200',
              ]"
              :title="att.error ?? att.name"
            >
              <template v-if="att.kind === 'image' && att.previewUrl">
                <img
                  :src="att.previewUrl"
                  :alt="att.name"
                  class="h-full w-full object-cover"
                />

                <div
                  v-if="att.status === 'uploading'"
                  class="absolute inset-0 flex items-center justify-center bg-black/40"
                >
                  <Loader2 class="h-4 w-4 animate-spin text-white" />
                </div>
              </template>

              <template v-else>
                <div class="flex h-full items-center gap-2">
                  <component
                    :is="fileIcon(att.mime ?? '', att.name).icon"
                    class="h-5 w-5 shrink-0"
                    :class="fileIcon(att.mime ?? '', att.name).color"
                  />

                  <div class="min-w-0 flex-1">
                    <p class="truncate text-[11px] font-medium text-slate-800">
                      {{ att.name }}
                    </p>

                    <p class="text-[10px] text-slate-500">
                      {{
                        att.sizeBytes ? formatFileSize(att.sizeBytes) : '...'
                      }}
                    </p>
                  </div>
                </div>

                <div
                  v-if="att.status === 'uploading'"
                  class="absolute inset-0 flex items-center justify-center bg-black/30"
                >
                  <Loader2 class="h-4 w-4 animate-spin text-white" />
                </div>
              </template>

              <button
                type="button"
                aria-label="Xoá file"
                title="Xoá"
                class="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition hover:bg-black/80 group-hover:opacity-100"
                @click="removeAttachment(att.id)"
              >
                <X class="h-3 w-3" />
              </button>
            </div>

            <div
              v-if="uploadingCount > 0"
              class="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-500"
            >
              Đang tải {{ uploadingCount }}…
            </div>
          </div>

          <div class="mx-auto max-w-[760px]">
            <div
              class="flex items-center gap-2  bg-white px-4 py-2.5 transition focus-within:border-slate-300 focus-within:outline-none"
            >
              <input
                ref="textareaEl"
                v-model="messageInput"
                type="text"
                :disabled="!activeId"
                placeholder="Aa..."
                class="flex-1 bg-transparent text-sm rounded-md border border-slate-200 text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-0"
                @keydown="onComposerKeydown"
                @input="onComposerInput"
                @paste="onPaste"
              />

          
              <button
                type="button"
                aria-label="Đính kèm file"
                title="Đính kèm file"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!activeId"
                @click="onPickFile"
              >
                <Paperclip :size="18" />
              </button>

              <button
                type="button"
                aria-label="Gửi"
                title="Gửi"
                class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500 text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canSend"
                @click="sendMessage"
              >
                <Send :size="16" />
              </button>
            </div>
          </div>

          <input
            ref="fileInputEl"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip"
            multiple
            class="hidden"
            @change="onFileInputChange"
          />
        </footer>
      </main>

      <!-- ================= RIGHT INFO PANEL ================= -->
      <ChatInfoPanel
        v-if="showInfoPanel"
        :conversation-id="activeId"
      />
    </div>
  </div>
</template>

<style scoped>
/* Thanh cuộn mỏng cho khu vực nội dung chat — width 6px, màu slate-300. */
.messages-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgb(203 213 225) transparent;
}
.messages-scroll::-webkit-scrollbar {
  width: 6px;
}
.messages-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.messages-scroll::-webkit-scrollbar-thumb {
  background-color: rgb(203 213 225);
  border-radius: 3px;
}
.messages-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgb(148 163 184);
}
</style>
