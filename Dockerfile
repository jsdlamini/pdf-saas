# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so the
# Clerk publishable key MUST be present here (not just at runtime). It is a
# public key, so baking it into the image is safe; the secret key stays runtime-only.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user; apt/tlmgr auto-install uses passwordless sudo for the
# scoped package managers only, so the web process cannot touch the rest of the
# filesystem. See /etc/sudoers.d/app below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ocrmypdf=14.0.1+dfsg1-1 tesseract-ocr=5.3.0-2 ghostscript=10.0.0~dfsg-11+deb12u8 qpdf latexmk texlive-extra-utils texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-fonts-extra texlive-science texlive-publishers texlive-pictures texlive-bibtex-extra biber tesseract-ocr-deu tesseract-ocr-eng tesseract-ocr-fra tesseract-ocr-spa tesseract-ocr-ita tesseract-ocr-por tesseract-ocr-nld tesseract-ocr-pol libreoffice-writer=4:7.4.7-1+deb12u14 python3 python3-pip python3-matplotlib g++ sudo pandoc \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir --break-system-packages pdf2docx==0.5.13 pymupdf==1.28.2 python-docx==1.2.0 \
 && useradd --create-home --shell /bin/bash app \
 && echo "app ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/tlmgr" > /etc/sudoers.d/app \
 && chmod 0440 /etc/sudoers.d/app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY scripts/pdf2word-convert.py ./scripts/pdf2word-convert.py
COPY scripts/pdf2word-structured.py ./scripts/pdf2word-structured.py
COPY scripts/log-binary-versions.sh ./scripts/log-binary-versions.sh

# Give the runtime user ownership of the app directory (Next.js writes .next/cache),
# then drop privileges. apt/tlmgr auto-install still works via scoped sudo.
RUN chown -R app:app /app

USER app

EXPOSE 3000
CMD ["sh", "-c", "sh /app/scripts/log-binary-versions.sh && npm run start"]
