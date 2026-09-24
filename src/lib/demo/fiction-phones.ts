import { toE164 } from "@/lib/phone/normalise-phone";

/**
 * ACMA numbers reserved for fiction (film, TV, and other creative works).
 * They are not allocated to people or businesses.
 * https://www.acma.gov.au/phone-numbers-use-tv-shows-films-and-creative-works
 */
const ACMA_FICTION_MOBILE_LOCAL = [
  "0491570006",
  "0491570156",
  "0491570157",
  "0491570158",
  "0491570159",
  "0491570110",
  "0491570313",
  "0491570737",
  "0491571266",
  "0491571491",
  "0491571804",
  "0491572549",
  "0491572665",
  "0491572983",
  "0491573770",
  "0491573087",
  "0491574118",
  "0491574632",
  "0491575254",
  "0491575789",
  "0491576398",
  "0491576801",
  "0491577426",
  "0491577644",
  "0491578957",
  "0491578148",
  "0491578888",
  "0491579212",
  "0491579760",
  "0491579455",
] as const;

export const ACMA_FICTION_MOBILES: string[] = ACMA_FICTION_MOBILE_LOCAL.map((local) => {
  const e164 = toE164(local);
  if (!e164) throw new Error(`ACMA fiction mobile failed E.164: ${local}`);
  return e164;
});

const FICTION_SET = new Set(ACMA_FICTION_MOBILES);

export function isAcmaFictionMobile(phoneE164: string): boolean {
  return FICTION_SET.has(phoneE164);
}
