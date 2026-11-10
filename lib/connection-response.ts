export async function connectionResponse<T>(response: Response, fallback: string): Promise<T> {
  const result = await response.json().catch(() => null) as T | null;
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error || `${fallback} (server response ${response.status}).`);
  if (!result || typeof result !== "object") throw new Error(`${fallback} Please try again.`);
  return result;
}
