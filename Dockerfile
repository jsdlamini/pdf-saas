# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Keep runtime as root so apt-based auto-install fallback can run when needed.
USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends ocrmypdf tesseract-ocr ghostscript qpdf latexmk texlive-extra-utils texlive-latex-base texlive-latex-recommended texlive-fonts-recommended texlive-science tesseract-ocr-deu tesseract-ocr-eng tesseract-ocr-fra tesseract-ocr-spa tesseract-ocr-ita tesseract-ocr-por tesseract-ocr-nld tesseract-ocr-pol \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
