const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_ORIGIN = 'https://superamber.example.invalid';
const FLASH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const FLASH_RESOURCE_ID = 'volc.bigasr.auc_turbo';

function runFfmpeg(args, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('AUDIO_CONVERSION_TIMEOUT'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString().slice(0, 800);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`AUDIO_CONVERSION_FAILED:${stderr.slice(-240)}`));
    });
  });
}

function extensionForMime(mimeType) {
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return '.m4a';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('wav')) return '.wav';
  return '.webm';
}

async function normalizeAudio(input, mimeType) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'superamber-asr-'));
  const inputPath = path.join(tempDir, `input${extensionForMime(mimeType)}`);
  const outputPath = path.join(tempDir, 'output.mp3');
  try {
    await fs.writeFile(inputPath, input, { mode: 0o600 });
    await runFfmpeg([
      '-v', 'error', '-y', '-i', inputPath, '-t', '90',
      '-vn', '-ac', '1', '-ar', '16000', '-codec:a', 'libmp3lame', '-b:a', '48k',
      outputPath,
    ]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function transcribeWithVolcengine(audioBuffer, { fetchImpl = fetch } = {}) {
  const appId = String(process.env.VOLC_ASR_APP_ID || '').trim();
  const accessToken = String(process.env.VOLC_ASR_ACCESS_TOKEN || '').trim();
  if (!appId || !accessToken) throw new Error('ASR_NOT_CONFIGURED');

  const requestId = crypto.randomUUID();
  const response = await fetchImpl(FLASH_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Api-App-Key': appId,
      'X-Api-Access-Key': accessToken,
      'X-Api-Resource-Id': FLASH_RESOURCE_ID,
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify({
      user: { uid: appId },
      audio: { data: audioBuffer.toString('base64') },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const statusCode = response.headers.get('x-api-status-code') || '';
  const providerMessage = response.headers.get('x-api-message') || '';
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // The provider sometimes reports errors only in response headers.
  }

  if (!response.ok || statusCode !== '20000000') {
    const error = new Error('ASR_PROVIDER_ERROR');
    error.providerCode = statusCode;
    error.providerMessage = providerMessage;
    throw error;
  }

  const text = String(payload?.result?.text || '').trim();
  if (!text) throw new Error('ASR_EMPTY_TRANSCRIPT');
  return {
    text,
    durationMs: Number(payload?.audio_info?.duration) || null,
    requestId,
  };
}

function createRateLimiter({ limit = 8, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const cloudflareIp = String(req.headers['cf-connecting-ip'] || '').trim();
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const key = cloudflareIp || forwarded || req.socket?.remoteAddress || 'unknown';
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > limit) return res.status(429).json({ error: '操作太频繁，请稍后再试' });
    return next();
  };
}

function createClassroomObservationAsrRouter({
  normalize = normalizeAudio,
  transcribe = transcribeWithVolcengine,
  allowedOrigin = ALLOWED_ORIGIN,
} = {}) {
  const router = express.Router();
  const rawAudio = express.raw({ type: ['audio/*', 'application/octet-stream'], limit: MAX_AUDIO_BYTES });

  router.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: process.env.VOLC_ASR_APP_ID && process.env.VOLC_ASR_ACCESS_TOKEN ? 'ready' : 'not_configured' });
  });

  const requireAllowedOrigin = (req, res, next) => {
    const origin = String(req.headers.origin || '').trim();
    if (origin !== allowedOrigin) return res.status(403).json({ error: '来源不受支持' });
    return next();
  };

  router.post('/transcribe', requireAllowedOrigin, createRateLimiter(), rawAudio, async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 500) {
      return res.status(400).json({ error: '没有收到有效录音' });
    }

    const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const startedAt = Date.now();
    try {
      const normalized = await normalize(req.body, mimeType);
      const result = await transcribe(normalized);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        text: result.text,
        durationMs: result.durationMs,
        processingMs: Date.now() - startedAt,
      });
    } catch (error) {
      const knownEmpty = error.message === 'ASR_EMPTY_TRANSCRIPT' || error.providerCode === '20000003';
      if (knownEmpty) return res.status(422).json({ error: '没有识别到清晰语音，请靠近麦克风再试一次' });
      if (error.message === 'ASR_NOT_CONFIGURED') return res.status(503).json({ error: '语音服务尚未配置' });
      console.error('[classroom-observation-asr]', JSON.stringify({
        message: error.message,
        providerCode: error.providerCode || '',
      }));
      return res.status(502).json({ error: '语音识别暂时失败，请稍后重试' });
    }
  });

  return router;
}

module.exports = {
  createClassroomObservationAsrRouter,
  normalizeAudio,
  transcribeWithVolcengine,
};
