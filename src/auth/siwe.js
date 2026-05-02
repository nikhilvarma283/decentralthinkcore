const { SiweMessage } = require("siwe");
const nonceStore = require("./nonce");
const logger = require("../lib/logger");

/**
 * Verify a SIWE signature.
 * Returns { wallet, domain } on success or throws with a descriptive message.
 */
async function verify(message, signature) {
  let siweMsg;
  try {
    siweMsg = new SiweMessage(message);
  } catch (err) {
    throw new Error("Invalid SIWE message format");
  }

  // Verify the cryptographic signature
  let result;
  try {
    result = await siweMsg.verify({ signature });
  } catch (err) {
    logger.warn("SIWE: signature verification failed", { error: err.message });
    throw new Error("Signature verification failed");
  }

  if (!result.success) {
    throw new Error(result.error?.type || "SIWE verification failed");
  }

  const wallet = siweMsg.address.toLowerCase();

  // Consume the nonce (replay protection)
  const valid = nonceStore.consume(wallet, siweMsg.nonce);
  if (!valid) {
    throw new Error("Nonce is invalid or expired");
  }

  return { wallet, domain: siweMsg.domain };
}

module.exports = { verify };
