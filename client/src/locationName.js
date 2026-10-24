import readApiResponse from "./readApiResponse.js";

export default async function lookupLocationName(latitude, longitude) {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
  });
  const response = await fetch(`/api/location/reverse?${query}`, {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("emergencycare-token"),
    },
  });
  return readApiResponse(response, "Could not look up this location.");
}
