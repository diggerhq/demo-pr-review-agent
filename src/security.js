import { createHmac, createSign, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(secret, payload, signatureHeader) {
  if (!secret || !signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(signatureHeader, "utf8");

  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, actualBytes);
}

export function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function signGitHubJwt({ issuer, privateKey, now = Date.now() }) {
  const nowSeconds = Math.floor(now / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: String(issuer),
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
}
