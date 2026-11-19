// Formats only tags on this station; no inferred or externally fetched address data.
export function formatStationAddress(tags: Readonly<Record<string, string | undefined>>): string | null {
  const value = (key: string) => tags[key]?.trim() || "";
  const comparisonKey = (text: string) => text.replace(/\s+/g, " ").toLowerCase();

  // Compare complete comma-separated components, never substrings (e.g. a ZIP
  // code that also happens to occur in a street number). Preserve source casing.
  const uniqueComponents = (parts: string[]) => {
    const seen = new Set<string>();
    return parts.flatMap((part) => part.split(",")).map((part) => part.trim()).filter((part) => {
      if (!part) return false;
      const key = comparisonKey(part);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(", ");
  };

  const full = value("addr:full");
  const number = value("addr:housenumber");
  const street = value("addr:street");
  const place = value("addr:place");
  const locality = [value("addr:city"), value("addr:state"), value("addr:postcode")];

  // Reject only exact matches to known incomplete values; do not guess at
  // address structure or reject a legitimate full address containing them.
  const matchesIncompleteField = [number, place, ...locality].some(
    (part) => part && comparisonKey(part) === comparisonKey(full)
  );
  // A bare number or punctuation is not a meaningful full street address.
  if (/\p{L}/u.test(full) && !matchesIncompleteField) return uniqueComponents([full]) || null;

  if (street) {
    return uniqueComponents([[number, street].filter(Boolean).join(" "), ...locality]) || null;
  }
  if (place && number) {
    return uniqueComponents([`${number} ${place}`, ...locality]) || null;
  }

  // An unnumbered place or locality is useful context, not a street address.
  const area = uniqueComponents([place, ...locality]);
  return area ? `Area: ${area}` : null;
}
