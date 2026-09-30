type SafeParseJSONResult = { success: true; data: unknown } | { success: false; error: string };

export function safeParseJSON(content: string): SafeParseJSONResult {
  if (content === "") {
    return { success: false, error: "Empty string" };
  }

  let data: unknown;

  try {
    data = JSON.parse(content);
  } catch (e) {
    return { success: false, error: "Invalid JSON" };
  }

  return { success: true, data };
}
