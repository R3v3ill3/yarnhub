/**
 * Stub for survey-engine option maps. OA wrote these into campaign
 * assessments; Yarnhub surveys (Phase C) will keep the maps on the
 * question options without a ratings pipeline.
 */

const BINARY_VALUE_MAX = 30;

export function normaliseOptionMaps(input: {
  maps_to_rating: number | null;
  maps_to_binary: string | null;
}): { maps_to_rating: number | null; maps_to_binary: string | null } {
  const rating = input.maps_to_rating;
  return {
    maps_to_rating:
      typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5
        ? rating
        : null,
    maps_to_binary: input.maps_to_binary
      ? input.maps_to_binary.slice(0, BINARY_VALUE_MAX)
      : null,
  };
}
