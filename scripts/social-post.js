#!/usr/bin/env node
/**
 * WiserFiles Social Media Auto-Poster
 * 
 * Posts to Twitter/X twice daily from a rotating pool of tweets.
 * Schedule via cron: 0 9,17 * * * /home/johns/social-poster/post.js
 * 
 * Setup: Set TWITTER_BEARER_TOKEN in environment.
 * Get a free token at https://developer.twitter.com/en/portal/dashboard
 */

const POSTS = [
  "25 free PDF tools. No upload limits. No account needed. Merge, split, OCR, sign, compress — all in your browser. 🔒 Files auto-deleted. 📱 Works offline. Try it: https://pdf.idealsoftwaresolutions.com",
  
  "Need to OCR a scanned PDF? WiserFiles does it in your browser — no upload stored, no account required. Free, private, instant. https://pdf.idealsoftwaresolutions.com/tools/ocr-pdf",
  
  "Students: stop paying for PDF tools. WiserFiles has 25 tools — merge, compress, sign, convert — all free, all private. Your files are encrypted and auto-deleted. https://pdf.idealsoftwaresolutions.com",
  
  "TIL you can merge PDFs without uploading them to a sketchy website. WiserFiles processes everything in your browser. Nothing is stored. Nothing is read. https://pdf.idealsoftwaresolutions.com/tools/merge-pdf",
  
  "Research students: WiserFiles has a built-in LaTeX editor with AI-powered compile fix suggestions. Write, compile, and fix your paper — all in one tab. Free. https://pdf.idealsoftwaresolutions.com/research-studio",
  
  "PDF to Word, Excel, or PowerPoint — real formatting, not text dumps. WiserFiles converts documents server-side with LibreOffice. Free, private, no account needed. https://pdf.idealsoftwaresolutions.com/tools/pdf-to-word",
  
  "Your PDF tool should not watermark your documents. Your PDF tool should not limit you to 2 files a day. Your PDF tool should not store your data. WiserFiles doesn't. 25 tools, zero catches. https://pdf.idealsoftwaresolutions.com",
  
  "Compare PDFs side by side — visual diff with color-coded changes. See exactly what was added, removed, and modified. Free, in your browser. https://pdf.idealsoftwaresolutions.com/tools/compare-pdf",
  
  "Sign PDFs electronically. Draw or type your signature, place it anywhere on the page. No account, no upload stored. Free. https://pdf.idealsoftwaresolutions.com/tools/sign-pdf",
  
  "Compress PDFs without destroying quality. WiserFiles compresses in your browser — your file never leaves your computer. Free, unlimited. https://pdf.idealsoftwaresolutions.com/tools/compress-pdf",
  
  "🎤 Speak your tool: 'compress my PDF' — WiserFiles finds the right tool instantly. Voice search, 25 tools, all free. https://pdf.idealsoftwaresolutions.com",
  
  "Redact sensitive information permanently. WiserFiles strips content under redaction areas — text cannot be recovered. Secure, private, free. https://pdf.idealsoftwaresolutions.com/tools/redact-pdf",
  
  "Import your existing LaTeX or Overleaf project as a zip — chapters, figures, and appendices restored in one click. Multi-file C++/Python runs too. https://pdf.idealsoftwaresolutions.com/research-studio",
  
  "No internet? No problem. 20 of WiserFiles' 25 tools run fully offline in your browser — merge, split, compress, sign, redact, and more. Install once, keep working anywhere. https://pdf.idealsoftwaresolutions.com",
];

const STATE_FILE = "/home/johns/social-poster/state.json";
const LOG_FILE = "/home/johns/social-poster/post.log";

const fs = require("fs");
const path = require("path");

function log(msg) {
  const entry = `[${new Date().toISOString()}] ${msg}`;
  console.log(entry);
  fs.appendFileSync(LOG_FILE, entry + "\n");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { index: 0, posted: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function postToTwitter(text) {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    log("TWITTER_BEARER_TOKEN not set — skipping post.");
    return false;
  }

  try {
    const response = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const err = await response.text();
      log(`Twitter API error: ${response.status} ${err}`);
      return false;
    }

    const data = await response.json();
    log(`Posted: ${data.data?.id || "unknown"} — "${text.slice(0, 80)}..."`);
    return true;
  } catch (e) {
    log(`Twitter post failed: ${e.message}`);
    return false;
  }
}

async function main() {
  const state = loadState();
  const post = POSTS[state.index % POSTS.length];

  log(`Post #${state.posted + 1}: "${post.slice(0, 80)}..."`);

  const ok = await postToTwitter(post);

  if (ok || !process.env.TWITTER_BEARER_TOKEN) {
    state.index = (state.index + 1) % POSTS.length;
    state.posted += 1;
    saveState(state);
  }
}

main().catch((e) => log(`Fatal: ${e.message}`));
