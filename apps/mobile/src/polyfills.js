import { getRandomValues } from 'expo-crypto';

// Hermes has no Web Crypto; uuid (offline client ids) needs a CSPRNG before any module runs.
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  globalThis.crypto = { ...(globalThis.crypto ?? {}), getRandomValues };
}
