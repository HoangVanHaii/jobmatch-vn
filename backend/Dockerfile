# syntax=docker/dockerfile:1
#
# JobMatch VN backend — production image (Express + TypeScript).
# Multi-stage: install deps -> compile TS -> slim runtime.
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
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# bcrypt ships a native binding, keep prod node_modules from deps.
COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 5000
CMD ["node", "dist/server.js"]
