export default async function readApiResponse(response, fallbackMessage) {
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(
      `The server returned an unreadable response (HTTP ${response.status}). Please try again.`,
    );
    error.status = response.status;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(result.message || fallbackMessage);
    error.status = response.status;
    throw error;
  }
  return result;
}
