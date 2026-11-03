import { AppError } from "../core/errors.js";

export function validateVrf(vrf: string): void {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,63}$/.test(vrf)) {
    throw new AppError("diagnostic_vrf_invalid", "VRF must be a single safe identifier (1-64 characters)");
  }
}

/** `value`, or `defaultValue` when omitted, if it is a safe integer from 1 to `max`. */
export function resolveBoundedInteger(
  value: number | undefined,
  defaultValue: number,
  max: number,
  invalid: { code: string; label: string; unit?: string }
): number {
  const resolved = value ?? defaultValue;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > max) {
    throw new AppError(invalid.code, `${invalid.label} must be between 1 and ${max}${invalid.unit === undefined ? "" : ` ${invalid.unit}`}`);
  }
  return resolved;
}
