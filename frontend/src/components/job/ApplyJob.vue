<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '@stores/auth';
import { jobApi } from '@services/job.api';
import { aiApi } from '@services/ai.api';

defineProps<{ job: any }>();
const auth = useAuthStore();
const applied = ref(false);
const generating = ref(false);
const coverLetter = ref('');
const cvId = ref('');

const generateCover = async () => {
  generating.value = true;
  try {
    // TODO: lấy CV data của user
    const { data } = await aiApi.generateCoverLetter({}, '');
    coverLetter.value = data.data.content;
  } finally { generating.value = false; }
};

const submit = async () => {
  try {
    await jobApi.apply(applied.value as any, { cvId: cvId.value, coverLetter: coverLetter.value });
    applied.value = true;
  } catch (e) { alert('Apply failed'); }
};
</script>
<template>
  <div class="card" v-if="auth.isAuthenticated">
    <h3 class="font-semibold mb-3">Apply công việc này</h3>
    <button v-if="!applied" @click="generateCover" :disabled="generating" class="btn-secondary mb-3">
      ✨ AI sinh cover letter
    </button>
    <textarea v-model="coverLetter" class="input min-h-[120px] mb-3" placeholder="Cover letter..."></textarea>
    <button v-if="!applied" @click="submit" class="btn-primary w-full">Apply ngay</button>
    <p v-else class="text-green-600 text-center font-semibold">✅ Đã apply!</p>
  </div>
</template>