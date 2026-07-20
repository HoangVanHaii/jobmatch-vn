<script setup lang="ts">
const props = defineProps<{ modelValue: Record<string, any> }>();
const emit = defineEmits<{
  (e: 'update:modelValue', val: Record<string, any>): void;
  (e: 'change'): void;
}>();

const update = (key: string, val: any) => {
  emit('update:modelValue', { ...props.modelValue, [key]: val });
  emit('change');
};
</script>
<template>
  <aside class="card space-y-4">
    <h3 class="font-semibold">Bộ lọc</h3>
    <div>
      <label class="text-sm">Cấp bậc</label>
      <select :value="modelValue.jobLevel" @change="update('jobLevel', ($event.target as HTMLSelectElement).value)" class="input mt-1">
        <option value="">Tất cả</option>
        <option value="intern">Intern</option>
        <option value="fresher">Fresher</option>
        <option value="junior">Junior</option>
        <option value="mid">Mid-level</option>
        <option value="senior">Senior</option>
        <option value="lead">Lead</option>
        <option value="manager">Manager</option>
      </select>
    </div>
    <div>
      <label class="text-sm">Loại hình</label>
      <select :value="modelValue.jobType" @change="update('jobType', ($event.target as HTMLSelectElement).value)" class="input mt-1">
        <option value="">Tất cả</option>
        <option value="full-time">Full-time</option>
        <option value="part-time">Part-time</option>
        <option value="contract">Contract</option>
        <option value="internship">Internship</option>
      </select>
    </div>
    <div>
      <label class="text-sm">Địa điểm</label>
      <input :value="modelValue.location" @input="update('location', ($event.target as HTMLInputElement).value)" class="input mt-1" placeholder="HCM, Hà Nội..." />
    </div>
  </aside>
</template>