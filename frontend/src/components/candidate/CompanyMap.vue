<script setup lang="ts">
/**
 * CompanyMap — render bản đồ Leaflet + OpenStreetMap tile cho 1 location.
 *
 *  - Props: `lat`, `lng` (number, bắt buộc) + `label` (popup text, optional).
 *  - Dùng `useTemplateRef` + `L.map(el)` trong `onMounted` — Leaflet cần DOM ref
 *    thực + cleanup khi unmount để tránh memory leak.
 *  - CSS `leaflet/dist/leaflet.css` import một lần ở đây (cần cho tile + control
 *    rendering đúng style).
 *  - OpenStreetMap tile miễn phí, không cần API key. Attribution giữ theo
 *    license OSM (required khi dùng tile).
 *  - invalidateSize sau `nextTick` để tránh render sai khi map nằm trong
 *    tab ẩn/panel chưa mounted xong (common case với v-show).
 */
import { nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import L, { type Map as LeafletMap, type Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';

const props = defineProps<{
  lat: number;
  lng: number;
  label?: string;
  /** Zoom level (1-19), mặc định 15 = street level. */
  zoom?: number;
}>();

const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer');
let map: LeafletMap | null = null;
let marker: Marker | null = null;

/** Default Leaflet marker icon load relative từ npm package — fix path
 *  để Vite bundle resolve đúng. */
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const initMap = (): void => {
  if (!mapContainer.value) return;
  map = L.map(mapContainer.value, {
    center: [props.lat, props.lng],
    zoom: props.zoom ?? 15,
    zoomControl: true,
    scrollWheelZoom: false,
  });
  // Xoá chữ "Leaflet" mặc định ở góc dưới (BSD-2 license cho phép).
  // VẪN giữ OSM attribution vì OSM tile yêu cầu credit theo ODbL license.
  map.attributionControl.setPrefix('');

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  marker = L.marker([props.lat, props.lng], { icon: defaultIcon }).addTo(map);
  if (props.label) {
    marker.bindPopup(`<strong>${props.label}</strong>`);
  }
};

/** Nếu lat/lng đổi sau khi mount (parent re-fetch), pan map tới vị trí mới. */
watch(() => [props.lat, props.lng] as const, async ([lat, lng]) => {
  if (!map || lat == null || lng == null) return;
  await nextTick();
  map.setView([lat, lng]);
  marker?.setLatLng([lat, lng]);
});

onMounted(() => {
  initMap();
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
  marker = null;
});
</script>

<template>
  <!-- `h-full w-full` để parent (wrapper) control size — ở JobDetailView
       wrapper set `h-48` để map nhỏ gọn trong sidebar phải. -->
  <div
    ref="mapContainer"
    class="h-full w-full"
  ></div>
</template>
