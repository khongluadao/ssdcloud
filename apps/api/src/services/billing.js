import { config } from "../config.js";

export function calcUploadCost(sizeBytes) {
  const sizeMb = sizeBytes / (1024 * 1024);
  return Math.ceil(sizeMb * config.uploadPricePerMb);
}
