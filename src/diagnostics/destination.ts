import { isIP } from "node:net";
import { AppError } from "../core/errors.js";

export type AddressFamily = 4 | 6;
export type AddressFamilyChoice = "ipv4" | "ipv6";

/** A Destination is an IP literal, restricted to unicast addresses, or an RFC 1123 host name that the executing
 * device resolves itself (ADR 0012). The server never resolves names, so address restrictions apply only to literals.
 */
export type ParsedDestination =
  | { kind: "literal"; address: string; addressFamily: AddressFamily }
  | { kind: "name"; name: string };

const MAX_NAME_LENGTH = 253;
const HOST_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function parseDestination(destination: string): ParsedDestination {
  if (isIP(destination) !== 0 || destination.includes("%")) {
    return { kind: "literal", address: destination, addressFamily: validateAddress(destination) };
  }
  if (!isHostName(destination)) {
    throw new AppError("diagnostic_address_invalid", "Destination must be an IPv4/IPv6 literal without interface scoping or a DNS host name");
  }
  return { kind: "name", name: destination };
}

/** RFC 1123 host name: LDH labels of 1-63 characters, at most 253 characters (an optional trailing dot excluded),
 * and at least one letter so that numeric strings such as `10.1.1` are never mistaken for names.
 */
export function isHostName(candidate: string): boolean {
  const withoutTrailingDot = candidate.endsWith(".") ? candidate.slice(0, -1) : candidate;
  if (withoutTrailingDot.length === 0 || withoutTrailingDot.length > MAX_NAME_LENGTH || !/[A-Za-z]/.test(withoutTrailingDot)) return false;
  return withoutTrailingDot.split(".").every((label) => HOST_LABEL_PATTERN.test(label));
}

/** Two Destinations are duplicates when their keys are equal: literals by canonical address, names ignoring case and
 * a trailing dot. A name and a literal never share a key.
 */
export function destinationKey(destination: ParsedDestination): string {
  return destination.kind === "literal"
    ? `literal:${canonicalAddress(destination.address, destination.addressFamily)}`
    : `name:${destination.name.toLowerCase().replace(/\.$/, "")}`;
}

/** The address family a request's Destination uses: a literal keeps its own; a name takes the source's family, else the
 * requested `address_family`, else IPv4. A requested family that contradicts the source is rejected.
 */
export function resolveDestinationFamily(
  destination: ParsedDestination,
  options: { sourceFamily: AddressFamily | undefined; addressFamily: AddressFamilyChoice | undefined }
): AddressFamily {
  if (destination.kind === "literal") return destination.addressFamily;
  if (options.sourceFamily !== undefined) return options.sourceFamily;
  return options.addressFamily === "ipv6" ? 6 : 4;
}

/** Rejects an `address_family` that disagrees with the source address's family. */
export function validateAddressFamilyAgainstSource(addressFamily: AddressFamilyChoice | undefined, sourceFamily: AddressFamily | undefined): void {
  if (addressFamily === undefined || sourceFamily === undefined) return;
  if ((addressFamily === "ipv6" ? 6 : 4) !== sourceFamily) {
    throw new AppError("diagnostic_address_family_conflict", "address_family conflicts with the address family of source");
  }
}

export function validateAddress(address: string): AddressFamily {
  const family = isIP(address);
  if (family === 0 || address.includes("%")) {
    throw new AppError("diagnostic_address_invalid", "Use an IPv4 or IPv6 literal without interface scoping");
  }
  if (family === 4) {
    validateIpv4(address.split(".").map(Number));
    return 4;
  }
  const halves = canonicalAddress(address, 6).split("::");
  const left = halves[0]?.split(":").filter(Boolean) ?? [];
  const right = halves[1]?.split(":").filter(Boolean) ?? [];
  const words = halves.length === 1
    ? left.map((word) => Number.parseInt(word, 16))
    : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right].map((word) => Number.parseInt(word, 16));
  const first = words[0] ?? 0;
  if (words.every((word) => word === 0) || (first & 0xff00) === 0xff00 || (first & 0xffc0) === 0xfe80) {
    throw new AppError("diagnostic_address_invalid", "Unspecified, multicast, and IPv6 link-local addresses are not supported");
  }
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    // Prevent mapped addresses from bypassing IPv4 destination restrictions.
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    validateIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  return 6;
}

/** Expects a literal already accepted by `isIP`, which only admits canonical dotted-decimal IPv4. */
export function canonicalAddress(address: string, addressFamily: AddressFamily): string {
  // WHATWG URL canonicalization compresses zeros, lowercases, and expands dotted IPv4-mapped IPv6 into hex words.
  return addressFamily === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
}

function validateIpv4(octets: number[]): void {
  if ((octets[0] ?? 0) === 0 || (octets[0] ?? 0) >= 224) {
    throw new AppError("diagnostic_address_invalid", "Unspecified, multicast, reserved, and limited broadcast addresses are not supported");
  }
}

/** Throws the execution failure for EOS's destination lookup and routing errors, shared by ping and traceroute.
 * `linePrefix` is a regular-expression source for what precedes the message on the line: ping prefixes its
 * errors with `ping: `; traceroute prints them bare. Returns when the output holds none of these.
 */
export function throwOnDestinationFailure(normalizedOutput: string, linePrefix: string): void {
  const unresolved = new RegExp(`^${linePrefix}(\\S+): (Name or service not known|Address family for hostname not supported)\\s*$`, "m").exec(normalizedOutput);
  if (unresolved?.[2] === "Name or service not known") {
    throw new AppError("diagnostic_destination_unresolved", "The device could not resolve the destination name");
  }
  if (unresolved) {
    throw new AppError("diagnostic_destination_unresolved",
      "The destination name has no address of the requested family on the device; set address_family to the other family or use a literal");
  }
  if (new RegExp(`^${linePrefix}connect: Network is unreachable\\s*$`, "m").test(normalizedOutput)) {
    throw new AppError("diagnostic_destination_no_route", "The device has no route to the destination");
  }
}
