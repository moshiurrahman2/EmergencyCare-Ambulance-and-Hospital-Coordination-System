export function errorHandler(error, _request, response, _next) {
  console.error("API request failed:", error.message);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  const message = status === 400
    ? "Request body must contain valid JSON."
    : status === 413
      ? "Request body is too large."
      : "Something went wrong. Please try again.";
  response.status(status).json({ message });
}
