# syntax=docker/dockerfile:1
#
# JobMatch VN backend — production image (Express + TypeScript).
# Multi-stage: install deps -> compile TS -> slim runtime.
#
# Runtime base dùng mcr.microsoft.com/playwright thay vì node:20-alpine vì
# cần Chromium + system deps cho Playwright server-side render PDF CV.
#
#   docker build -t jobmatch-vn-backend ./backend
#   docker run --rm -p 5000:5000 --env-file ./backend/.env jobmatch-vn-backend
#

# ---------- deps ----------
FROM node:20-alpine AS deps
# Native build tools for packages like bcrypt / pdf-parse.
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runtime ----------
# mcr.microsoft.com/playwright image có sẵn Node 20 + Chromium + toàn bộ
# system deps (libnss3, libxkbcommon, libdrm, libgbm, fonts, ...). Match version
# với package playwright-core đã cài (^1.62.1).
#
# Nếu sau này nâng playwright-core, bump tag base image tương ứng. Tag list:
# https://mcr.microsoft.com/v2/playwright/tags/list
FROM mcr.microsoft.com/playwright:v1.62.1-jammy AS runner
WORKDIR /app
ENV NODE_ENV=production
# PLAYWRIGHT_BROWSERS_PATH không cần set — base image đã install Chromium
# đúng vị trí mà playwright-core tìm (ms-playwright/).
# PRINT_TOKEN_SECRET bắt buộc set qua --env-file / docker secret (≥32 chars).
# PLAYWRIGHT_MAX_CONCURRENCY mặc định 2 — bump lên 3-4 nếu container có ≥4GB RAM.

COPY package.json package-lock.json* ./
# Chỉ copy production deps: dùng npm ci + omit dev để giảm image size.
# Nhưng vì deps stage dùng alpine và playwright-core binaries prebuilt cho alpine
# không tương thích với jammy runtime (glibc vs musl), ta install lại từ scratch.
RUN npm ci --omit=dev \
 && npm install --no-save playwright-core@^1.62.1

COPY --from=build /app/dist ./dist
EXPOSE 5000
CMD ["node", "dist/server.js"]
