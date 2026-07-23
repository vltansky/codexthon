export function unwrapBase44FunctionResponse<T>(response: unknown): T {
  if (!response || typeof response !== "object" || !("data" in response)) {
    throw new Error("Base44 function response is missing response data");
  }

  return response.data as T;
}
