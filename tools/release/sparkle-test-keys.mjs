// Prints a throwaway Sparkle EdDSA key pair as JSON {privateKey, publicKey}, both base64, in the formats Sparkle's
// generate_keys exports (the 32-byte Ed25519 seed) and SUPublicEDKey expects (the 32-byte public key). Tests only:
// the production key is made with generate_keys and kept as a repository secret (docs/distribution.md).
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url");
const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
console.log(JSON.stringify({ privateKey: seed.toString("base64"), publicKey: raw.toString("base64") }));
