// 2단계 인증(TOTP, RFC 6238) — 외부 의존성 없이 Node 내장 crypto로 구현.
// 인증앱(Google Authenticator, Microsoft Authenticator 등)과 호환 (SHA1·6자리·30초).
import crypto from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  str = String(str).replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, value = 0; const out = [];
  for (const c of str) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// 새 시크릿(base32) 생성
export function generateSecret(len = 20) {
  return base32Encode(crypto.randomBytes(len));
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

// 현재 시각 기준 6자리 코드
export function totpCode(secret, time = Date.now()) {
  return hotp(secret, Math.floor(time / 1000 / 30));
}

// 입력 코드 검증 (앞뒤 window 스텝 허용 — 시계 오차 대비)
export function verifyTotp(secret, token, window = 1) {
  if (!secret || !token) return false;
  token = String(token).trim();
  if (!/^\d{6}$/.test(token)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, counter + i) === token) return true;
  }
  return false;
}

// 인증앱 등록용 otpauth URI
export function otpauthURL(secret, label, issuer = '1-3반 커뮤니티') {
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params.toString()}`;
}
