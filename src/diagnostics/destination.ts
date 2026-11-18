import { isIP } from "node:net";
import { AppError } from "../core/errors.js";

export type AddressFamily = 4 | 6;
export type AddressFamilyChoice = "ipv4" | "ipv6";

/** A Destination is an IP literal, restricted to unicast addresses, or an RFC 1123 host name that the executing
 * device resolves itself (ADR 0012). The server never resolves names, so address restrictions apply only to literals.
 */
type ParsedDestination =
  | { kind: "literal"; address: string; addressFamily: AddressFamily }
  | { kind: "name"; name: string };

/** The request fields every destination-based diagnostic shares with each of its Destinations. */
export interface DestinationOptions {
  source?: string | undefined;
  address_family?: AddressFamilyChoice | undefined;
}

/** One Destination checked against its request's options: the family its command uses, and the key that
 * identifies duplicates (literals by canonical address, names ignoring case and a trailing dot).
 */
export interface PreparedDestination {
  destination: string;
  addressFamily: AddressFamily;
  key: string;
}

const MAX_NAME_LENGTH = 253;
const HOST_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// One part of an IPv4 address in the classic inet_aton syntax: decimal, octal with a leading 0, or hex with 0x.
const LEGACY_IPV4_PART_PATTERN = /^(?:0x[0-9a-f]*|[0-9]+)$/i;

/** Validates every Destination of a request, and rejects duplicates, before any is dispatched. Ping and traceroute
 * both prepare their Destinations here, so they apply the same parsing, family and uniqueness rules.
 */
export function prepareDestinations(destinations: readonly string[], options: DestinationOptions): PreparedDestination[] {
  const preparedDestinations = destinations.map((destination) => prepareDestination(destination, options));
  if (new Set(preparedDestinations.map((prepared) => prepared.key)).size !== preparedDestinations.length) {
    throw new AppError("diagnostic_destination_duplicate", "Each destination may appear only once per request");
  }
  return preparedDestinations;
}

/** A name takes the source's family, else the requested `address_family`, else IPv4; a literal keeps its own.
 * An `address_family` that contradicts the source, or a source of another family than the destination, is rejected.
 */
export function prepareDestination(destination: string, options: DestinationOptions): PreparedDestination {
  const parsed = parseDestination(destination);
  const sourceFamily = options.source === undefined ? undefined : validateAddress(options.source);
  const requestedFamily = options.address_family === undefined ? undefined : options.address_family === "ipv6" ? 6 : 4;
  if (requestedFamily !== undefined && sourceFamily !== undefined && requestedFamily !== sourceFamily) {
    throw new AppError("diagnostic_address_family_conflict", "address_family conflicts with the address family of source");
  }
  const addressFamily = parsed.kind === "literal" ? parsed.addressFamily : sourceFamily ?? requestedFamily ?? 4;
  if (sourceFamily !== undefined && sourceFamily !== addressFamily) {
    throw new AppError("diagnostic_source_invalid", "Source and destination must use the same IP address family");
  }
  const key = parsed.kind === "literal"
    ? `literal:${canonicalAddress(parsed.address, parsed.addressFamily)}`
    : `name:${parsed.name.toLowerCase().replace(/\.$/, "")}`;
  return { destination, addressFamily, key };
}

function parseDestination(destination: string): ParsedDestination {
  if (isIP(destination) !== 0 || destination.includes("%")) {
    return { kind: "literal", address: destination, addressFamily: validateAddress(destination) };
  }
  // EOS hands names to glibc, which reads forms such as 0x7f000001 or 0xe0.1 as IPv4 addresses without any DNS lookup
  // (measured on cEOS 4.34.3M), so treating them as names would skip the literal restrictions.
  if (isLegacyNumericIpv4(destination)) {
    throw new AppError("diagnostic_address_invalid", "Use a dotted-decimal IPv4 literal; hex, octal and shortened IPv4 forms are not accepted");
  }
  if (!isHostName(destination)) {
    throw new AppError("diagnostic_address_invalid", "Destination must be an IPv4/IPv6 literal without interface scoping or a DNS host name");
  }
  return { kind: "name", name: destination };
}

/** Whether the classic inet_aton parser would read the string as an IPv4 address: one to four numeric parts. */
function isLegacyNumericIpv4(candidate: string): boolean {
  const withoutTrailingDot = candidate.endsWith(".") ? candidate.slice(0, -1) : candidate;
  const parts = withoutTrailingDot.split(".");
  return parts.length <= 4 && parts.every((part) => LEGACY_IPV4_PART_PATTERN.test(part));
}

/** RFC 1123 host name: LDH labels of 1-63 characters, at most 253 characters (an optional trailing dot excluded),
 * and at least one letter so that numeric strings such as `10.1.1` are never mistaken for names.
 */
function isHostName(candidate: string): boolean {
  const withoutTrailingDot = candidate.endsWith(".") ? candidate.slice(0, -1) : candidate;
  if (withoutTrailingDot.length === 0 || withoutTrailingDot.length > MAX_NAME_LENGTH || !/[A-Za-z]/.test(withoutTrailingDot)) return false;
  return withoutTrailingDot.split(".").every((label) => HOST_LABEL_PATTERN.test(label));
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
